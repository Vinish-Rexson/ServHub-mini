ALTER TABLE build_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE deployments ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE projects ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();
