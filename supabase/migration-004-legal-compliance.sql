-- Migration 004: Legal compliance fields
-- Adds age verification, terms acceptance, and minor status to profiles

-- Age verification & terms acceptance
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_minor BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tos_version TEXT;

-- User reports (trade safety - Mudança 6)
CREATE TABLE IF NOT EXISTS user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES profiles(id),
  reported_user_id UUID NOT NULL REFERENCES profiles(id),
  trade_id UUID REFERENCES trade_requests(id),
  category TEXT NOT NULL CHECK (category IN ('no_show', 'inappropriate', 'scam', 'harassment', 'other')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved'))
);

-- RLS for user_reports
ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create reports"
  ON user_reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Users can view own reports"
  ON user_reports FOR SELECT
  TO authenticated
  USING (auth.uid() = reporter_id);
