# Figurinhas Copa 2026

PWA para gerenciar seu album de figurinhas da Copa do Mundo 2026. Rastreie suas figurinhas, escaneie com IA e encontre pessoas para trocar.

## Stack

- **Next.js 14** (App Router)
- **Supabase** (Auth + PostgreSQL)
- **Tailwind CSS**
- **Google Gemini 2.5 Flash** (scanner de figurinhas)
- **Stripe** (pagamento Premium)
- **Vercel** (deploy)

## Setup

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variaveis de ambiente

Copie o arquivo de exemplo e preencha:

```bash
cp .env.local.example .env.local
```

### 3. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Execute os scripts SQL na ordem:
   - `supabase/schema.sql` — tabelas, RLS, triggers
   - `supabase/migration-001.sql` — ajustes no perfil
   - `supabase/migration-002-trades.sql` — funcoes de trade matching
   - `supabase/migration-003-premium.sql` — colunas premium
3. Configure Google OAuth no Supabase Dashboard > Auth > Providers
4. Configure Apple Sign-In (ver seção abaixo)

### 4. Seed de figurinhas

```bash
npm run seed
```

### 5. Stripe

1. Crie uma conta em [stripe.com](https://stripe.com)
2. Copie as chaves (Dashboard > Developers > API Keys):
   - `STRIPE_SECRET_KEY` (sk_test_...)
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test_...)
3. Crie um webhook (Dashboard > Developers > Webhooks):
   - URL: `https://your-app.vercel.app/api/stripe/webhook`
   - Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`
   - Copie o `STRIPE_WEBHOOK_SECRET` (whsec_...)

### 6. Deploy na Vercel

```bash
npx vercel
```

Adicione as variaveis de ambiente no dashboard da Vercel (Settings > Environment Variables).

### 7. Apple Sign-In

Para ativar o login com Apple, é necessário:

**Apple Developer Account**
1. Acesse [developer.apple.com](https://developer.apple.com)
2. Crie um **App ID** em Certificates > Identifiers, com "Sign in with Apple" ativado
3. Crie um **Service ID** (ex: `com.figurinhas.web`) — esse será o Client ID
4. No Service ID, ative "Sign in with Apple" e configure:
   - Domain: seu domínio (ex: `figurinhas.vercel.app`)
   - Return URL: a callback URL do Supabase (ver abaixo)
5. Crie uma **Key** em Keys, com "Sign in with Apple" ativado — faça download do `.p8`
6. Anote: **Team ID** (canto superior direito), **Key ID** e o conteúdo do `.p8`

**Supabase Dashboard**
1. Acesse Authentication > Providers > Apple
2. Ative o provider e preencha:
   - `Client ID (Service ID)`: o Service ID criado (ex: `com.figurinhas.web`)
   - `Team ID`: ID do time Apple Developer
   - `Key ID`: ID da chave gerada
   - `Private Key`: conteúdo do arquivo `.p8`
3. Copie a **Callback URL** gerada pelo Supabase e adicione no Service ID da Apple (passo 4 acima)

### 8. Google Gemini

1. Acesse [aistudio.google.com](https://aistudio.google.com)
2. Crie uma API Key para o projeto
3. Ative a Generative Language API no Google Cloud Console

## Desenvolvimento

```bash
npm run dev
```

## Modelo Freemium

| Feature | Free | Plus (R$9,90) | Premium (R$19,90) |
|---------|------|---------------|-------------------|
| Rastreamento manual | Ate 100 figurinhas | Ilimitado | Ilimitado |
| Scanner IA | Bloqueado | Ilimitado | Ilimitado |
| Trade matching | Bloqueado | Bloqueado | Ilimitado |
| Relatorio semanal | Nao | Nao | Sim |
