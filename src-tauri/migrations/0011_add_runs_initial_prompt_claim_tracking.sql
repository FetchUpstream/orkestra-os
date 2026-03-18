ALTER TABLE runs
ADD COLUMN initial_prompt_claimed_at TEXT;

ALTER TABLE runs
ADD COLUMN initial_prompt_claim_request_id TEXT;
