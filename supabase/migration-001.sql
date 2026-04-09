-- Migration 001: Adicionar campos faltantes
-- Rodar no SQL Editor do Supabase

-- Adicionar campos na tabela profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone VARCHAR(20) UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ DEFAULT now();

-- Remover coluna updated_at se existir (substituída por last_active)
ALTER TABLE profiles DROP COLUMN IF EXISTS updated_at;

-- Adicionar campo type na tabela stickers
ALTER TABLE stickers ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'player';

-- Alterar tipos de colunas para consistência com o prompt
ALTER TABLE stickers ALTER COLUMN number TYPE VARCHAR(10);
ALTER TABLE stickers ALTER COLUMN player_name TYPE VARCHAR(100);
ALTER TABLE stickers ALTER COLUMN country TYPE VARCHAR(50);
ALTER TABLE stickers ALTER COLUMN section TYPE VARCHAR(50);

-- Alterar status na user_stickers
ALTER TABLE user_stickers ALTER COLUMN status TYPE VARCHAR(10);

-- Índices novos
CREATE INDEX IF NOT EXISTS idx_stickers_type ON stickers(type);
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);
