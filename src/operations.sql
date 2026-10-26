-- Additive migration. Existing teams, games and published results remain intact.
CREATE TABLE IF NOT EXISTS event_control (
 id int PRIMARY KEY CHECK(id=1), password_hash text, password_epoch int NOT NULL DEFAULT 0,
 metrics jsonb NOT NULL DEFAULT '[]', tiebreakers jsonb NOT NULL DEFAULT '[]'
);
INSERT INTO event_control(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS people (
 id serial PRIMARY KEY, name varchar(100) NOT NULL, team_id int REFERENCES teams(id) ON DELETE SET NULL,
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS staff (
 telegram_id bigint PRIMARY KEY, display_name varchar(100) NOT NULL,
 role varchar(20) NOT NULL CHECK(role IN ('admin','lead','helper','revoked')),
 person_id int UNIQUE REFERENCES people(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS join_requests (
 telegram_id bigint PRIMARY KEY, display_name varchar(100) NOT NULL,
 password_epoch int NOT NULL, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS login_limits (
 key text PRIMARY KEY, count int NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now(),
 blocked_until timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fields (
 id serial PRIMARY KEY, name varchar(80) UNIQUE NOT NULL, closed boolean NOT NULL DEFAULT false,
 version int NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS turbo_sessions (
 id serial PRIMARY KEY, name varchar(100) NOT NULL, min_games int NOT NULL DEFAULT 3 CHECK(min_games BETWEEN 1 AND 1000),
 metrics jsonb NOT NULL DEFAULT '["received","distributed","hits","empty_round"]',
 tiebreakers jsonb NOT NULL DEFAULT '["received","distributed","hits","empty_round"]',
 finished boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS match_ops (
 id serial PRIMARY KEY, game_id int UNIQUE REFERENCES games(id) ON DELETE CASCADE,
 session_id int REFERENCES turbo_sessions(id), field_id int REFERENCES fields(id),
 helper_id bigint REFERENCES staff(telegram_id), coordinator_id bigint REFERENCES staff(telegram_id),
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','assigned','live','paused','pending','correction','finished','cancelled')),
 current_round int NOT NULL DEFAULT 1 CHECK(current_round>0), winning_side char(1) CHECK(winning_side IN ('A','B')),
 reporter_id bigint, approved_by bigint, reason text NOT NULL DEFAULT '', resume_locked boolean NOT NULL DEFAULT false,
 version int NOT NULL DEFAULT 1, started_at timestamptz, ended_at timestamptz,
 CHECK((game_id IS NULL) <> (session_id IS NULL))
);
CREATE TABLE IF NOT EXISTS match_roster (
 id serial PRIMARY KEY, match_id int NOT NULL REFERENCES match_ops(id) ON DELETE CASCADE,
 side char(1) NOT NULL CHECK(side IN ('A','B')),
 person_id int REFERENCES people(id), team_id int REFERENCES teams(id), guest_name varchar(100),
 CHECK(num_nonnulls(person_id,team_id,guest_name)=1),
 UNIQUE(match_id,person_id), UNIQUE(match_id,team_id)
);
CREATE TABLE IF NOT EXISTS metric_events (
 id bigserial PRIMARY KEY, match_id int NOT NULL REFERENCES match_ops(id) ON DELETE CASCADE,
 subject_id int REFERENCES match_roster(id), metric text NOT NULL CHECK(metric IN ('received','distributed','hits','empty_round','round')),
 amount int NOT NULL CHECK(amount BETWEEN 0 AND 10000), actor_id bigint NOT NULL,
 undone_by bigint, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operation_requests (request_id varchar(150) PRIMARY KEY, actor_id bigint NOT NULL, action text NOT NULL);
CREATE INDEX IF NOT EXISTS ops_status ON match_ops(status);
CREATE INDEX IF NOT EXISTS metrics_match ON metric_events(match_id);
CREATE INDEX IF NOT EXISTS roster_person ON match_roster(person_id);
CREATE INDEX IF NOT EXISTS audit_time ON audit_log(created_at);

ALTER TABLE event_control ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'classic' CHECK(mode IN ('classic','turbo'));
ALTER TABLE event_control ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Europe/Berlin';
ALTER TABLE event_control ADD COLUMN IF NOT EXISTS site_password_hash text;
ALTER TABLE event_control ADD COLUMN IF NOT EXISTS site_methods jsonb NOT NULL DEFAULT '[]';
ALTER TABLE event_control ADD COLUMN IF NOT EXISTS site_epoch int NOT NULL DEFAULT 1;
ALTER TABLE event_control ADD COLUMN IF NOT EXISTS site_version int NOT NULL DEFAULT 1;
ALTER TABLE match_ops ADD COLUMN IF NOT EXISTS played_on date;
UPDATE match_ops SET played_on=coalesce(started_at,ended_at,now()) AT TIME ZONE 'Europe/Berlin' WHERE played_on IS NULL;
ALTER TABLE match_ops ALTER COLUMN played_on SET DEFAULT CURRENT_DATE;
ALTER TABLE match_ops ALTER COLUMN played_on SET NOT NULL;
ALTER TABLE event_control ADD COLUMN IF NOT EXISTS turbo_min_games int NOT NULL DEFAULT 3 CHECK(turbo_min_games BETWEEN 1 AND 1000);
CREATE INDEX IF NOT EXISTS ops_day ON match_ops(played_on);
CREATE TABLE IF NOT EXISTS site_accounts (
 id serial PRIMARY KEY, username varchar(80) UNIQUE NOT NULL, password_hash text,
 telegram_id bigint UNIQUE, active boolean NOT NULL DEFAULT true, version int NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS site_sessions (
 token_hash char(64) PRIMARY KEY, account_id int REFERENCES site_accounts(id) ON DELETE CASCADE,
 account_version int, epoch int NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_session_expiry ON site_sessions(expires_at);
CREATE TABLE IF NOT EXISTS site_challenges (
 token_hash char(64) PRIMARY KEY, binding_hash char(64) NOT NULL, telegram_id bigint,
 account_id int REFERENCES site_accounts(id) ON DELETE CASCADE,
 account_version int, remember boolean NOT NULL DEFAULT false,
 approved boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL,
 epoch int NOT NULL
);

ALTER TABLE event_control ADD COLUMN IF NOT EXISTS mode_initialized boolean NOT NULL DEFAULT false;

ALTER TABLE metric_events ADD COLUMN IF NOT EXISTS round_no int;

ALTER TABLE event_control ADD COLUMN IF NOT EXISTS turbo_tiebreakers jsonb NOT NULL DEFAULT '["received","distributed","hits","empty_round"]';

ALTER TABLE site_challenges ADD COLUMN IF NOT EXISTS next_path text NOT NULL DEFAULT '/';
