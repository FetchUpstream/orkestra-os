ALTER TABLE runs
ADD COLUMN initial_prompt_sent_at TEXT;

ALTER TABLE runs
ADD COLUMN initial_prompt_client_request_id TEXT;
