-- 2026-05-26 Organization Management MVP — Slice 1



CREATE TABLE IF NOT EXISTS organizations (
    id            SERIAL PRIMARY KEY,
    org_id        VARCHAR(50) UNIQUE NOT NULL,
    name          VARCHAR(100) NOT NULL,
    description   TEXT DEFAULT '',
    owner_user_id VARCHAR(50) NOT NULL REFERENCES users(user_id),
    status        VARCHAR(20) NOT NULL DEFAULT 'active',
    color         VARCHAR(20),
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by    VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner  ON organizations(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);



CREATE TABLE IF NOT EXISTS organization_members (
    org_id    VARCHAR(50) NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
    user_id   VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role      VARCHAR(20) NOT NULL DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    added_by  VARCHAR(50),
    PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_role ON organization_members(role);



--    resource_type ∈ {'project','media','group'}
--    share_target_type ∈ {'org','project'}
CREATE TABLE IF NOT EXISTS resource_shares (
    id                  SERIAL PRIMARY KEY,
    share_id            VARCHAR(50) UNIQUE NOT NULL,
    resource_type       VARCHAR(20) NOT NULL,
    resource_id         VARCHAR(50) NOT NULL,
    share_target_type   VARCHAR(20) NOT NULL,
    share_target_id     VARCHAR(50) NOT NULL,
    granted_by_user_id  VARCHAR(50) NOT NULL REFERENCES users(user_id),
    granted_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (resource_type, resource_id, share_target_type, share_target_id)
);

CREATE INDEX IF NOT EXISTS idx_shares_resource ON resource_shares(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_shares_target   ON resource_shares(share_target_type, share_target_id);



CREATE OR REPLACE FUNCTION update_organizations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_organizations_updated_at();
