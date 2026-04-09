-- =============================================================
-- Álbum de Figurinhas Copa do Mundo FIFA 2026
-- Schema para Supabase - Rodar no SQL Editor
-- =============================================================

-- Tabela de perfis (extensão do auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  phone VARCHAR(20) UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  location_lat DOUBLE PRECISION,
  location_lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active TIMESTAMPTZ DEFAULT now()
);

-- Figurinhas do álbum (dados estáticos do álbum Panini)
CREATE TABLE stickers (
  id SERIAL PRIMARY KEY,
  number VARCHAR(10) NOT NULL UNIQUE,
  player_name VARCHAR(100),
  country VARCHAR(50) NOT NULL,
  section VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'player',
  image_url TEXT
);

-- Inventário do usuário
CREATE TABLE user_stickers (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sticker_id INTEGER NOT NULL REFERENCES stickers(id),
  status VARCHAR(10) NOT NULL CHECK (status IN ('owned', 'missing', 'duplicate')),
  quantity INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, sticker_id)
);

-- =============================================================
-- Row Level Security
-- =============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE stickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stickers ENABLE ROW LEVEL SECURITY;

-- Profiles: leitura pública, edição apenas do próprio
CREATE POLICY "Perfil público para leitura"
  ON profiles FOR SELECT USING (true);

CREATE POLICY "Usuário edita próprio perfil"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Usuário insere próprio perfil"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Stickers: leitura pública (dados do álbum)
CREATE POLICY "Figurinhas visíveis para todos"
  ON stickers FOR SELECT USING (true);

-- User Stickers: apenas o próprio usuário
CREATE POLICY "Usuário vê próprio inventário"
  ON user_stickers FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Usuário gerencia próprio inventário"
  ON user_stickers FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário atualiza próprio inventário"
  ON user_stickers FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Usuário deleta próprio inventário"
  ON user_stickers FOR DELETE USING (auth.uid() = user_id);

-- =============================================================
-- Trigger: criar perfil automaticamente no signup
-- =============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================================
-- Índices para performance
-- =============================================================

CREATE INDEX idx_user_stickers_user ON user_stickers(user_id);
CREATE INDEX idx_user_stickers_status ON user_stickers(user_id, status);
CREATE INDEX idx_stickers_country ON stickers(country);
CREATE INDEX idx_stickers_section ON stickers(section);
CREATE INDEX idx_stickers_type ON stickers(type);
CREATE INDEX idx_profiles_location ON profiles(location_lat, location_lng);
CREATE INDEX idx_profiles_phone ON profiles(phone);
