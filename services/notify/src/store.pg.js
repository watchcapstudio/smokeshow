// The durable store: the same interface as createMemoryStore(), over Postgres.
//
// It takes a `pg`-compatible pool (anything with `query(text, values)`) rather
// than importing a driver, so this file adds no dependency and can be pointed
// at a pool, a client, or a transaction. schema.sql is the DDL.
//
// Two queries carry the service:
//   listOccupiedCells   — one row per cell that costs money this hour
//   claimNotification   — an INSERT whose primary key is the exactly-once
//                         guarantee. ON CONFLICT DO NOTHING returning zero
//                         rows means "someone already sent this", and that is
//                         the whole duplicate-suppression mechanism.

const ENTITLED_PREDICATE = `
  d.enabled
  and d.push_token is not null
  and not e.revoked
  and (case when e.expires_at is null then e.active else e.expires_at > $1 end)
`;

function rowToDevice(row, locations = []) {
  return {
    id: row.id,
    secretHash: row.secret_hash,
    platform: row.platform,
    pushToken: row.push_token,
    appUserId: row.app_user_id,
    timezone: row.timezone,
    threshold: row.threshold,
    quietHours: { enabled: row.quiet_enabled, startHour: row.quiet_start, endHour: row.quiet_end },
    notificationTypes: {
      inbound: row.notify_inbound,
      peak: row.notify_peak,
      clear: row.notify_clear,
    },
    sensitiveHousehold: row.sensitive_household,
    enabled: row.enabled,
    locations,
    createdAtMs: row.created_at?.getTime?.() ?? null,
    updatedAtMs: row.updated_at?.getTime?.() ?? null,
  };
}

function rowToLocation(row) {
  return {
    label: row.label,
    lat: row.lat,
    lon: row.lon,
    cellKey: row.cell_key,
    threshold: row.threshold,
  };
}

export function createPgStore(pool, { schema = 'smokeshow_notify', requireEntitlement = true } = {}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error('Postgres schema must be a valid unquoted identifier');
  }
  // Schema-qualify every table. Transaction poolers may move consecutive
  // queries between backend sessions, so relying on a session search_path is
  // unsafe even when the connection string accepts startup options.
  const table = (name) => `"${schema}"."${name}"`;
  const devices = table('devices');
  const deviceLocations = table('device_locations');
  const entitlements = table('entitlements');
  const aliases = table('app_user_aliases');
  const cellStates = table('cell_states');
  const sentNotifications = table('sent_notifications');
  const subscriberJoin = requireEntitlement
    ? `
      join ${devices} d on d.id = l.device_id
      left join ${aliases} a on a.alias_id = d.app_user_id
      join ${entitlements} e on e.app_user_id = coalesce(a.canonical_id, d.app_user_id)
    `
    : `join ${devices} d on d.id = l.device_id`;
  // Keep the timestamp parameter in both modes so the cell and subscriber
  // queries retain the same placeholders when entitlement gating is toggled.
  const deliverablePredicate = requireEntitlement
    ? ENTITLED_PREDICATE
    : `d.enabled and d.push_token is not null and $1::timestamptz is not null`;

  async function loadLocations(deviceId) {
    const { rows } = await pool.query(
      `select cell_key, label, lat, lon, threshold from ${deviceLocations} where device_id = $1 order by created_at`,
      [deviceId],
    );
    return rows.map(rowToLocation);
  }

  async function replaceLocations(deviceId, locations) {
    await pool.query(`delete from ${deviceLocations} where device_id = $1`, [deviceId]);
    for (const loc of locations ?? []) {
      await pool.query(
        `insert into ${deviceLocations} (device_id, cell_key, label, lat, lon, threshold)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (device_id, lat, lon) do update
           set cell_key = excluded.cell_key, label = excluded.label, threshold = excluded.threshold`,
        [deviceId, loc.cellKey, loc.label, loc.lat, loc.lon, loc.threshold ?? null],
      );
    }
  }

  return {
    async registerDevice(record) {
      await pool.query(
        `insert into ${devices}
           (id, secret_hash, platform, push_token, app_user_id, timezone, threshold,
            quiet_enabled, quiet_start, quiet_end, notify_inbound, notify_peak,
            notify_clear, sensitive_household, enabled)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          record.id,
          record.secretHash,
          record.platform,
          record.pushToken,
          record.appUserId,
          record.timezone,
          record.threshold,
          record.quietHours.enabled,
          record.quietHours.startHour,
          record.quietHours.endHour,
          record.notificationTypes.inbound,
          record.notificationTypes.peak,
          record.notificationTypes.clear,
          record.sensitiveHousehold,
          record.enabled,
        ],
      );
      await replaceLocations(record.id, record.locations);
      return record;
    },

    async getDevice(deviceId) {
      const { rows } = await pool.query(`select * from ${devices} where id = $1`, [deviceId]);
      if (!rows.length) return null;
      return rowToDevice(rows[0], await loadLocations(deviceId));
    },

    async updateDevice(deviceId, patch) {
      const columns = {
        pushToken: 'push_token',
        platform: 'platform',
        timezone: 'timezone',
        threshold: 'threshold',
        sensitiveHousehold: 'sensitive_household',
        enabled: 'enabled',
        appUserId: 'app_user_id',
      };
      const sets = [];
      const values = [];
      for (const [key, column] of Object.entries(columns)) {
        if (patch[key] === undefined) continue;
        values.push(patch[key]);
        sets.push(`${column} = $${values.length}`);
      }
      if (patch.quietHours !== undefined) {
        values.push(patch.quietHours.enabled, patch.quietHours.startHour, patch.quietHours.endHour);
        sets.push(
          `quiet_enabled = $${values.length - 2}`,
          `quiet_start = $${values.length - 1}`,
          `quiet_end = $${values.length}`,
        );
      }
      if (patch.notificationTypes !== undefined) {
        values.push(
          patch.notificationTypes.inbound,
          patch.notificationTypes.peak,
          patch.notificationTypes.clear,
        );
        sets.push(
          `notify_inbound = $${values.length - 2}`,
          `notify_peak = $${values.length - 1}`,
          `notify_clear = $${values.length}`,
        );
      }
      if (sets.length) {
        values.push(deviceId);
        await pool.query(`update ${devices} set ${sets.join(', ')}, updated_at = now() where id = $${values.length}`, values);
      }
      if (patch.locations !== undefined) await replaceLocations(deviceId, patch.locations);
      return this.getDevice(deviceId);
    },

    async deleteDevice(deviceId) {
      const { rowCount } = await pool.query(`delete from ${devices} where id = $1`, [deviceId]);
      return rowCount > 0;
    },

    async clearPushToken(deviceId, token) {
      const { rowCount } = await pool.query(
        `update ${devices} set push_token = null, updated_at = now()
          where id = $1 and ($2::text is null or push_token = $2)`,
        [deviceId, token ?? null],
      );
      return rowCount > 0;
    },

    // The cost model, in one query. Returns cells, not users.
    async listOccupiedCells(nowMs = Date.now()) {
      const { rows } = await pool.query(
        `select distinct l.cell_key from ${deviceLocations} l ${subscriberJoin} where ${deliverablePredicate} order by 1`,
        [new Date(nowMs)],
      );
      return rows.map((r) => r.cell_key);
    },

    async listCellSubscribers(cellKey, nowMs = Date.now()) {
      const { rows } = await pool.query(
        `select d.*, l.cell_key as loc_cell_key, l.label as loc_label, l.lat as loc_lat,
                l.lon as loc_lon, l.threshold as loc_threshold
           from ${deviceLocations} l ${subscriberJoin}
          where ${deliverablePredicate} and l.cell_key = $2`,
        [new Date(nowMs), cellKey],
      );
      return rows.map((row) => ({
        device: rowToDevice(row),
        location: {
          label: row.loc_label,
          lat: row.loc_lat,
          lon: row.loc_lon,
          cellKey: row.loc_cell_key,
          threshold: row.loc_threshold,
        },
      }));
    },

    async getCellState(cellKey) {
      const { rows } = await pool.query(`select state from ${cellStates} where cell_key = $1`, [cellKey]);
      return rows[0]?.state ?? null;
    },

    async putCellState(cellKey, state) {
      await pool.query(
        `insert into ${cellStates} (cell_key, state) values ($1, $2)
         on conflict (cell_key) do update set state = excluded.state, updated_at = now()`,
        [cellKey, state],
      );
    },

    // Zero rows back means another run already claimed this transition. That
    // is the duplicate suppression — it is a database constraint, not a
    // best-effort check, so two workers racing the same cell cannot both send.
    async claimNotification({ deviceId, dedupeKey, cellKey, sentAtMs = Date.now() }) {
      const { rowCount } = await pool.query(
        `insert into ${sentNotifications} (device_id, dedupe_key, cell_key, sent_at)
         values ($1, $2, $3, $4) on conflict (device_id, dedupe_key) do nothing`,
        [deviceId, dedupeKey, cellKey, new Date(sentAtMs)],
      );
      return rowCount > 0;
    },

    async releaseNotification({ deviceId, dedupeKey }) {
      await pool.query(`delete from ${sentNotifications} where device_id = $1 and dedupe_key = $2`, [
        deviceId,
        dedupeKey,
      ]);
      return true;
    },

    async lastNotifiedAt(deviceId, cellKey) {
      const { rows } = await pool.query(
        `select sent_at from ${sentNotifications} where device_id = $1 and cell_key = $2
          order by sent_at desc limit 1`,
        [deviceId, cellKey],
      );
      return rows[0]?.sent_at?.getTime?.() ?? null;
    },

    async pruneSent(beforeMs) {
      const { rowCount } = await pool.query(`delete from ${sentNotifications} where sent_at < $1`, [
        new Date(beforeMs),
      ]);
      return rowCount;
    },

    async upsertEntitlement(appUserId, record) {
      const { rows } = await pool.query(`select canonical_id from ${aliases} where alias_id = $1`, [
        appUserId,
      ]);
      const id = rows[0]?.canonical_id ?? appUserId;
      await pool.query(
        `insert into ${entitlements} as target
           (app_user_id, active, revoked, will_renew, billing_issue, expires_at,
            product_id, period_type, store, environment, last_event_id, last_event_type)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (app_user_id) do update set
           active = excluded.active, revoked = excluded.revoked, will_renew = excluded.will_renew,
           billing_issue = excluded.billing_issue, expires_at = excluded.expires_at,
           product_id = coalesce(excluded.product_id, target.product_id),
           period_type = coalesce(excluded.period_type, target.period_type),
           store = coalesce(excluded.store, target.store),
           environment = coalesce(excluded.environment, target.environment),
           last_event_id = excluded.last_event_id, last_event_type = excluded.last_event_type,
           updated_at = now()`,
        [
          id,
          record.active ?? false,
          record.revoked ?? false,
          record.willRenew ?? null,
          record.billingIssue ?? false,
          record.expiresAtMs == null ? null : new Date(record.expiresAtMs),
          record.productId ?? null,
          record.periodType ?? null,
          record.store ?? null,
          record.environment ?? null,
          record.lastEventId ?? null,
          record.lastEventType ?? null,
        ],
      );
      return { ...record, appUserId: id };
    },

    async getEntitlement(appUserId) {
      const { rows } = await pool.query(
        `select e.* from ${entitlements} e
           left join ${aliases} a on a.alias_id = $1
          where e.app_user_id = coalesce(a.canonical_id, $1)`,
        [appUserId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        appUserId: row.app_user_id,
        active: row.active,
        revoked: row.revoked,
        willRenew: row.will_renew,
        billingIssue: row.billing_issue,
        expiresAtMs: row.expires_at?.getTime?.() ?? null,
        productId: row.product_id,
        periodType: row.period_type,
        store: row.store,
        environment: row.environment,
        lastEventType: row.last_event_type,
      };
    },

    async aliasAppUser(aliasId, canonicalId) {
      if (!aliasId || !canonicalId || aliasId === canonicalId) return;
      await pool.query(
        `insert into ${aliases} (alias_id, canonical_id) values ($1, $2)
         on conflict (alias_id) do update set canonical_id = excluded.canonical_id`,
        [aliasId, canonicalId],
      );
      // Move an entitlement that landed on the alias before the alias existed.
      await pool.query(
        `insert into ${entitlements} (app_user_id, active, revoked, will_renew, billing_issue, expires_at,
                                   product_id, period_type, store, environment, last_event_id, last_event_type)
         select $2, active, revoked, will_renew, billing_issue, expires_at,
                product_id, period_type, store, environment, last_event_id, last_event_type
           from ${entitlements} where app_user_id = $1
         on conflict (app_user_id) do nothing`,
        [aliasId, canonicalId],
      );
      await pool.query(`delete from ${entitlements} where app_user_id = $1`, [aliasId]);
    },

    async isDeviceEntitled(deviceId, nowMs = Date.now()) {
      if (!requireEntitlement) {
        const { rows } = await pool.query(`select 1 from ${devices} where id = $1`, [deviceId]);
        return rows.length > 0;
      }
      const { rows } = await pool.query(
        `select 1 from ${devices} d
           left join ${aliases} a on a.alias_id = d.app_user_id
           join ${entitlements} e on e.app_user_id = coalesce(a.canonical_id, d.app_user_id)
          where d.id = $2 and not e.revoked
            and (case when e.expires_at is null then e.active else e.expires_at > $1 end)`,
        [new Date(nowMs), deviceId],
      );
      return rows.length > 0;
    },

    async stats(nowMs = Date.now()) {
      const { rows } = await pool.query(
        `select
           (select count(*) from ${devices}) as devices,
           (select count(distinct l.cell_key) from ${deviceLocations} l ${subscriberJoin} where ${deliverablePredicate}) as cells,
           (select count(*) from ${entitlements}) as entitlements`,
        [new Date(nowMs)],
      );
      return {
        devices: Number(rows[0].devices),
        cells: Number(rows[0].cells),
        entitlements: Number(rows[0].entitlements),
      };
    },

    async close() {
      await pool.end?.();
    },
  };
}
