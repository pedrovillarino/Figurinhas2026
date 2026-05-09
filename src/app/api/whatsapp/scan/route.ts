import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { sendText } from '@/lib/zapi'
import { getScanLimit, type Tier } from '@/lib/tiers'
import { getQuotas, buildPaywallMessage } from '@/lib/whatsapp-quotas'
import { matchSymbolByName } from '@/lib/symbol-synonyms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br').trim()

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Pedro 2026-05-08: badge hints (visual_hint do DB) injetados no prompt
// pra ajudar Gemini a desambiguar escudos/símbolos. Função em vez de
// const pra permitir interpolação.
function buildScanInstruction(
  badgeHints: Array<{ number: string; country: string; visual_hint: string }> = [],
): string {
  const badgeTable = badgeHints.length > 0
    ? `

═══════════════════════════════════════════════════════════════════════
🏅 TABELA RÁPIDA DE IDENTIFICAÇÃO DE ESCUDOS

Use SOMENTE quando a figurinha for um BADGE (escudo/emblema isolado, sem
foto de jogador, código termina em -1 tipo BRA-1 / ARG-1). Compare as
pistas visuais abaixo pra confirmar o country code:

${badgeHints.map(h => `• ${h.number} (${h.country}): ${h.visual_hint}`).join('\n')}

Se um badge bate com uma das descrições acima, registre o código exato
com confiança alta. Se não bate (país não listado), use heurística geral
de bandeira/cores e baixe a confiança pra ≤ 0.6 pra user confirmar.
═══════════════════════════════════════════════════════════════════════
`
    : ''
  return `Você identifica figurinhas Panini Copa do Mundo 2026. Retorne JSON apenas.${badgeTable}

═══════════════════════════════════════════════════════════════════════
🧭 PRIMEIRA DECISÃO: QUE TIPO DE PÁGINA É A FOTO?

Antes de qualquer coisa, classifique a página:

A) PÁGINA DE PAÍS (header "WE ARE [PAÍS]" + bandeira + escudo + grid de
   slots numerados com código tipo MEX-3, BRA-12 etc) → use MODO
   CHECKLIST DE PÁGINA (próxima seção).

B) PÁGINA ESPECIAL (FIFA World Cup section / Coca-Cola / PANINI Extras
   / abertura do álbum / contracapa). Aqui o layout NÃO é o grid padrão
   de país. → use modo OBJECT DETECTION: identifique cada figurinha
   visível usando as descrições visuais detalhadas das seções FIFA WORLD
   CUP, PANINI EXTRAS e COCA-COLA mais abaixo. NÃO aplique checklist
   posicional aqui.

C) FOTO DE FIGURINHA(S) AVULSA(S) (pacotinho aberto, mão segurando
   figurinha, várias figurinhas espalhadas na mesa) → modo OBJECT
   DETECTION normal pra cada figurinha individual visível.

═══════════════════════════════════════════════════════════════════════
⚠️ ATENÇÃO ESPECIAL — INFO DE GROUP STAGE NAS PÁGINAS DE PAÍS:
Páginas de país frequentemente têm uma SEÇÃO INFERIOR/LATERAL com
informações da fase de grupos: mini-card "GROUP A/B/C…" + 4 BANDEIRAS
PEQUENAS dos times do grupo + lista de jogos com data/estádio/ícone de
bola. ⚠️ NADA disso são figurinhas — são informação impressa do álbum.
NÃO retorne esses elementos no array de stickers.

═══════════════════════════════════════════════════════════════════════
🎯 MODO CHECKLIST DE PÁGINA (use SEMPRE que a foto mostrar uma página
de país aberta — header tipo "WE ARE MEXICO" + bandeira + grid de slots
numerados). Esta é a abordagem PRINCIPAL pra páginas de país.

PASSO A PASSO:
1. Identifique o CÓDIGO DO PAÍS pelo header (ex: "WE ARE MEXICO" → MEX,
   "WE ARE BRAZIL" → BRA). Cada país tem 20 figurinhas no álbum:
   posição 1 (escudo da federação) + posições 2-12 e 14-19 (jogadores) +
   posição 13 (foto do time) + posição 20 (jogador final).
2. Varra a página INTEIRA, posição por posição (1 a 19/20). NÃO ignore
   slots nos CANTOS (header pequeno topo-esquerdo, bordas) — eles também
   contam. Em geral cada página de país tem 7-9 slots por face do álbum
   (lado esquerdo + lado direito = página dupla).
3. Para CADA slot visível, classifique como FILLED ou EMPTY:

   ✅ FILLED (figurinha colada/presente): você vê uma FOTO REAL de
      jogador (rosto humano + camisa nacional + fundo gráfico).

      LAYOUT FIXO da frente da figurinha de jogador:
      - TOPO: "26" estilizado gigante (decoração) + logo "26 FIFA" canto
        superior direito. ⚠️ Esse "26" NÃO é número da figurinha.
      - LATERAL DIREITA: BANDEIRA-BOLA (círculo com cores da bandeira
        nacional) acima de SIGLA país 3 letras estilizadas (SEN, COL,
        BRA, ARG, FRA, CUW, CPV...). Letras semi-transparentes.
      - CENTRO: foto do jogador com camisa nacional + escudo da federação.
      - RODAPÉ: pílula colorida com NOME do jogador (sobrenome em CAIXA
        ALTA NEGRITO + primeiro nome normal, ex: "LAMINE CAMARA",
        "EXEQUIEL PALACIOS"), seguido de data nasc · altura · peso, e
        clube com país em parênteses. Logo Panini canto inferior.

      🎯 IDENTIFICAÇÃO em camadas (use a + alta disponível):
        1. NOME do jogador no rodapé → match no DB resolve país e número.
        2. PROVA REAL: o país do nome (DB) precisa BATER com pelo menos
           1 pista visual: bandeira-bola (cores), sigla 3-letras lateral,
           ou camisa+escudo nacional.
        3. Se 2+ pistas batem → confidence 0.90+. Se só 1 → 0.70-0.85.
        4. Se CONFLITO (ex: nome diz "BRA" mas vejo camisa celeste e sigla
           "ARG") → confidence baixa OU retorna vazio. NUNCA retorne
           confiança alta com pistas conflitantes.

      ⚠️ NA DÚVIDA, NÃO CHUTE — retorna array vazio:
        - Nome ilegível, bandeira/sigla/camisa todos cobertos, ou pistas
          conflitantes → NÃO retorne aquela figurinha.
        - Dois jogadores com nome parecido e não dá pra desambiguar →
          NÃO retorne.
        - É melhor reportar "0 figurinhas detectadas" do que reportar
          1 ERRADA. Erro silencioso destrói confiança.

      ⚠️ CONFUSÕES COMUNS:
        - "26" gigante = decoração Copa 2026, NÃO número da figurinha.
        - Sigla 3 letras = código país, NÃO número.
        - Frente NÃO mostra "PAIS-N" visível. Use NOME pra resolver.
        - Se em slot do álbum: use o rótulo IMPRESSO ao lado (ex: BRA 7).

   ❌ EMPTY (slot vazio aguardando figurinha): você vê o TEMPLATE DO
      ÁLBUM — fundo verde-claro/colorido com LETRAS GIGANTES do país
      como marca-d'água (ex: "MX" repetido em letras enormes faded,
      "BR" em verde, "AR" em azul-claro), texto pequeno "MEX 3" + nome
      do jogador "JORGE SÁNCHEZ" como RÓTULO IMPRESSO no slot, e
      NENHUMA foto de rosto humano dentro.

      ⚠️⚠️⚠️ ARMADILHA PRINCIPAL: o slot vazio TEM o código (ex:
      "MEX 3") e o nome do jogador (ex: "Jorge Sánchez") IMPRESSOS no
      próprio template como placeholder. **NÃO REPORTE ISSO COMO
      FIGURINHA**. Se o interior do retângulo NÃO TEM uma foto
      fotográfica de rosto humano com camisa de time, é EMPTY — PULE.
      Ler o código no template ≠ figurinha presente.

4. Retorne SOMENTE as posições FILLED no array de stickers.

═══════════════════════════════════════════════════════════════════════
🗺️ MAPA DAS PÁGINAS ESPECIAIS DO ÁLBUM (Pedro 2026-05-05)

Pra páginas que NÃO sejam de país, use as descrições abaixo. Em todas,
o critério é igual: SLOT VAZIO mostra placeholder retangular branco/cor
clara com label "FWC-X" / "CC-X" e SEM rosto humano fotográfico
dentro. SLOT FILLED tem foto/imagem do cromo real colado.

📘 PÁGINA DE ABERTURA — "WE ARE PANINI" (intro do álbum):
   - Topo: "Quadro de honra" — lista de campeões anteriores (Italy 1934,
     Brazil 1958, etc) em texto. Tem 1 SLOT pequeno marcado "00" no topo
     desse painel — esse é o cromo FWC-0 ("We are Panini" foil).
   - Painel central: "Os símbolos" — gráfico/legenda de posições (goleiro,
     zagueiro, etc). NÃO É CROMO.
   - Lista de 48 países em barras coloridas A-L (ex: "16 CAN Canada",
     "32 USA USA"). NÃO É CROMO.
   - Bottom: 4 SLOTS marcados FWC-1 (Emblema Oficial), FWC-2 (Slogan),
     FWC-3 (Mascotes), FWC-4 (Slogan Oficial / Bola).

🌎 PÁGINA HOST COUNTRIES AND CITIES (CAN/MEX/USA):
   - Header: "FIFA WORLD CUP 2026 - HOST COUNTRIES AND CITIES"
   - 4 SLOTS: FWC-5 (Bola Oficial Trionda), FWC-6 (Emblema CAN),
     FWC-7 (Emblema MEX), FWC-8 (Emblema USA).
   - Cidades + estádios listados ao lado (Toronto/Vancouver/Atlanta/
     Boston/etc). NÃO SÃO CROMOS — só info do torneio.

🏆 PÁGINA FIFA WORLD CUP HISTORY (presented by FIFA Museum):
   - Fundo ROXO/AZUL escuro, header "FIFA WORLD CUP HISTORY".
   - 11 SLOTS REAIS de cromo: FWC-9 a FWC-19. Cada um é o squad photo
     (fileira de jogadores em campo) de um Mundial específico:
     FWC-9 Italy 1934, FWC-10 Brazil 1950, FWC-11 Switzerland 1954,
     FWC-12 Chile 1962, FWC-13 Germany 1974, FWC-14 Mexico 1986,
     FWC-15 USA 1994, FWC-16 Korea/Japan 2002, FWC-17 Germany 2006,
     FWC-18 Brazil 2014, FWC-19 Qatar 2022.
   - 🚨🚨🚨 ARMADILHA CRÍTICA: a página INCLUI VÁRIAS ILUSTRAÇÕES
     IMPRESSAS no template que SIMULAM cromos colados:
     • Mini-portraits "ARTILHEIRO" (fotos pequenas de jogadores
       individuais como Eusébio, Just Fontaine, Gerd Müller, etc)
       com numeração própria 4-13. ESSES SÃO IMPRESSOS NO PAPEL —
       NÃO SÃO CROMOS COLECIONÁVEIS.
     • Squad photos de outros Mundiais (URUGUAY 1930, ITALY 1938,
       BRAZIL 1958, ENGLAND 1966, etc) que NÃO TÊM label FWC-X
       visível — também IMPRESSOS no papel, NÃO são cromos.
   - REGRA: só reporte FILLED se o slot tem label "FWC X" claro e
     visível e tem squad photo COBRINDO o slot. Tudo que tem aparência
     de "ARTILHEIRO" + numeração diferente, ou squad photo SEM label
     FWC, é DECORATIVO — IGNORE.

🥤 PÁGINA COCA-COLA (CC1 a CC14):

   ⚠️ IMPORTANTE — distingua CARACTERÍSTICAS DA PÁGINA vs DO CROMO:

   PÁGINA (só visível quando user fotografa o álbum aberto):
   - Fundo VERMELHO + grande ONDA BRANCA cruzando
   - Logo Coca-Cola decorando a página
   - Texto descritivo do jogador ao lado de cada slot
   Esses são elementos DECORATIVOS DA PÁGINA — NÃO estão impressos no
   cromo em si.

   CROMO (visível quando user fotografa um cromo solto na mesa ou
   colado no slot — é isso que você precisa identificar como Coca):
   - Fundo DARK photographic (foto IN-GAME/ação, NÃO o estúdio
     branco/cores do time como nos cromos normais de seleção)
   - Nome do jogador impresso VERTICALMENTE na BORDA ESQUERDA, em
     letras BRANCAS MAIÚSCULAS GRANDES
   - Country code entre parênteses ao lado do nome (ex:
     "EMILIANO MARTÍNEZ (ARG)", "LAMINE YAMAL (ESP)",
     "HARRY KANE (ENG)", "FEDERICO VALVERDE (URU)")
   - Emblema FIFA World Cup 2026 estilizado no canto SUPERIOR DIREITO
     (parece letras abstratas "CW" em branco)
   - SEM logo da Coca-Cola no cromo
   - SEM "PANINI" badge
   - SEM badge vermelho "EXTRA STICKER"
   Essas pistas JUNTAS identificam um cromo Coca-Cola. A pista
   ÚNICA MAIS DISTINTIVA é o NOME VERTICAL na borda esquerda com o
   country code em parênteses — NENHUM outro tipo de cromo tem esse
   layout.

   ⚠️ O número da CAMISA do jogador (ex: "23" na camisa do Emiliano
   Martínez, "22" do Lautaro) faz parte da foto, NÃO é o número da
   figurinha. Pra cromos Coca-Cola, number fica "" — defina country
   = "Coca" e leia o player_name normalmente.

   - 14 SLOTS distribuídos em 2 páginas (CC1-6 numa, CC7-14 noutra).
   - Slot vazio: retângulo branco com label "CC1", "CC2", etc.

═══════════════════════════════════════════════════════════════════════

Para CADA figurinha física visível (frente ou verso):
- player_name: nome EXATO impresso (ex: "Neymar Jr"). Pra figurinhas SEM nome de jogador (símbolos/figuras), use o rótulo canônico — veja seção SÍMBOLOS abaixo. Se ilegível, use "?".
- country: país (ex: "Brasil", "Argentina"), "FIFA" pra seção FIFA World Cup, ou "Extra" pra PANINI Extras (veja abaixo).
- number: só se você ver um código claro tipo "BRA-17" ou "BRA 17" (use hífen). Senão "".
- status: "filled" se figurinha real está presente (frente OU verso). "empty" só pra slot vazio do álbum (retângulo em branco com nome impresso EMBAIXO como placeholder).
- confidence: 0.0–1.0 honesto. Abaixo de 0.4, pule.
- tier: SÓ pra PANINI Extras. "ouro" | "prata" | "bronze" | "regular". Omita pra figurinhas normais.

⚠️ VERSO DE FIGURINHA — LAYOUT FIXO (todas as figs do álbum seguem o mesmo padrão):

  ┌──────────────────────────────────────┐
  │ [FIFA WORLD CUP 2026]   [PAIS  N]    │  ← 2 PÍLULAS no topo (cinza claro)
  │                                      │
  │            ╔══╗                      │
  │            ║26║   FIFA               │  ← logo grande "26 FIFA"
  │            ║FIFA║  OFFICIAL          │     centralizado
  │            ╚══╝   LICENSED PRODUCT   │
  │                                      │
  │  texto regulatório pequeno  [PANINI] │  ← rodapé
  └──────────────────────────────────────┘

PRIMÁRIA — pílula CANTO SUPERIOR DIREITO:
  - Formato exato: <CODIGO_PAIS><ESPAÇO><NUMERO> (ex: "CIV 3", "EGY 11", "GER 12", "ECU 10", "JOR 5", "CUW 9", "HAI 19", "BEL 9", "COL 5", "BRA 7", "JOR 10", "SCO 14")
  - Texto PRETO em fundo CINZA-CLARO/CINZA-MÉDIO, formato pílula arredondada
  - Código sempre 3 LETRAS MAIÚSCULAS + 1 ou 2 dígitos
  - Posição: TOPO DIREITO, sempre alinhado paralelo à pílula esquerda

SECUNDÁRIA — pílula CANTO SUPERIOR ESQUERDO:
  - Texto fixo "FIFA WORLD CUP 2026" em todas as figs (não muda)
  - Use APENAS pra confirmar que é verso de Panini (não pra extrair número)

ELEMENTOS CENTRAIS (todos versos):
  - Logo grande "26 FIFA" + troféu estilizado preto/cinza centralizado
  - Texto "FIFA OFFICIAL LICENSED PRODUCT" preto à direita do logo
  - Texto regulatório em letras MUITO pequenas (não tente ler — é licença)
  - Logo PANINI vermelho/branco no canto inferior

REGRAS:
1. Se conseguir LER claramente a pílula superior direita → retorne:
     face: "back"
     number: "<PAIS>-<N>" (com TRAÇO no formato canônico, ex: "CIV-3", não "CIV 3")
     confidence: 0.85+ (verso é mais legível que frente FOIL)
2. Se a pílula estiver borrada, cortada ou ilegível → retorne array stickers VAZIO. NÃO CHUTE.
3. ⚠️ NÃO infira FWC-0 "We are Panini" só por ver fundo claro/foil. FWC-0 tem foto REAL de jogador chutando bicicleta na FRENTE. Verso só tem logos + pílula. Sem foto = NÃO é FWC-0.
4. Múltiplas figurinhas no verso na MESMA foto: liste cada uma com sua pílula. A foto pode ter 5-12 versos lado-a-lado em fileira.
5. ⚠️ FIGURINHAS SOBREPOSTAS / EMPILHADAS:
   - É comum o user fotografar várias figurinhas em PILHA ou SOBREPOSTAS, onde só a FAIXA SUPERIOR (com as 2 pílulas) de algumas está visível — o resto fica coberto pela próxima figurinha.
   - **ISSO TAMBÉM CONTA como detecção válida**: se você consegue ler a pílula [PAIS] [N] superior direita (ex: BRA 7), retorne a figurinha mesmo que o restante do verso esteja oculto.
   - Critério único: pílula superior direita LEGÍVEL = figurinha detectada. NÃO precisa ver o logo central, FIFA, regulatório nem PANINI rodapé.
   - Aceite confiança 0.80-0.95 se a pílula estiver bem visível mesmo com 70% da figurinha coberta.

⚠️ DICA CRÍTICA: pílulas do verso são MAIS LEGÍVEIS que números na frente FOIL/holográfica das figs especiais (badges, FWC-0/1/2/3/4/5). Pra essas, verso é a fonte mais confiável.

⚠️ SÍMBOLOS (figurinhas SEM nome de jogador — você precisa RECONHECER VISUALMENTE):

Cada um dos 48 PAÍSES tem 2 símbolos fixos (sempre nas posições 1 e 13):
- {PAIS}-1: ESCUDO da federação. LEIA AS LETRAS no escudo pra identificar o país. player_name = "Emblem". Acronimos chave:
  - CBF=Brasil, AFA=Argentina, FFF=França, DFB=Alemanha, RFEF=Espanha (coroa real), FA=Inglaterra (3 leões), FPF=Portugal (5 escudos azuis), KNVB=Holanda, HNS=Croácia, KBVB=Bélgica, AUF=Uruguai (4 estrelas), FCF=Colômbia, FEF=Equador, APF=Paraguai, FMF=México (águia), USSF=USA, Canada Soccer=Canadá (folha bordo), FRMF=Marrocos, EFA=Egito, FSF=Senegal, FAF=Argélia, FTF=Tunísia (águia + texto árabe), FIF=Costa do Marfim, GFA=Gana, FECOFA=R.D. Congo, SAFA=África do Sul, SAFF=Arábia Saudita, JFA=Jordan E Japão (escudos diferentes), QFA=Catar (círculo branco + texto árabe), UFA=Uzbequistão, KFA=Coreia, FFA=Austrália, NZF=N.Zelândia, TFF=Turquia, FAČR=Tchéquia, FSBiH=Bósnia, NFF=Noruega (texto NORGE), SvFF=Suécia, SFV=Suíça (cruz branca), ÖFB=Áustria (águia preta), SFA=Escócia (leão), FEPAFUT=Panamá, FHF=Haiti, FFK=Curaçao, FFIRI=Irã, IFA=Iraque.
  - Escudos parecidos — diferencie:
    - NOR (NFF) vs SUI (Suíça): ambos cruz branca em vermelho. NOR tem texto NORGE+NFF + leões; SUI cruz pura, sem texto.
    - AUT (ÖFB) vs TUN (FTF) vs GHA: todos com águia. AUT águia preta em escudo vermelho/branco; TUN águia em círculo vermelho com texto árabe; GHA layout diferente.
    - POR (FPF) vs PER: mesma sigla FPF! POR tem 5 escudos azuis + castelos + cruz; PER escudo simples vermelho/branco com "FPF" grande.
    - JFA = Japão E Jordan! JPN corvo com bola; JOR falcão com escudo.
  - Descrições visuais detalhadas (referência canônica de escudos):
    - TUN-1 (FTF): águia BRANCA estilizada em CÍRCULO VERMELHO no centro, texto árabe "تونس" no topo, texto francês "FÉDÉRATION TUNISIENNE DE FOOTBALL" em volta
    - NOR-1 (NFF): escudo com CRUZ NORUEGUESA (vermelho/branco/azul), "NORGE" texto no topo + "NFF" no meio, com DOIS LEÕES segurando o escudo
    - URU-1 (AUF): escudo VERMELHO com letras "AUF" em laranja, listras AZUL/BRANCO/AZUL nas laterais, bola embaixo, 4 ESTRELAS DOURADAS no topo (campeão WC 1930+1950)
    - QAT-1 (QFA): escudo vermelho/branco com BOLA ESTILIZADA preta + texto árabe + "QFA" embaixo
    - AUT-1 (ÖFB): ÁGUIA PRETA estilizada gigante, escudo VERMELHO/BRANCO/VERMELHO no centro, "SEIT ÖFB 1904" texto
    - KOR-1 (KFA): TIGRE estilizado PRETO em moldura RETANGULAR VERMELHA, "KFA" embaixo, fundo branco
    - AUS-1 (Football Australia): BOLA estilizada laranja/verde no centro + texto "FOOTBALL AUSTRALIA" em letras pretas grandes embaixo
    - ALG-1 (FAF Argélia): BOLA preta com ASAS VERDES + LUA CRESCENTE vermelha + texto árabe "الجزائر" embaixo, fundo branco circular
    - GHA-1 (GFA Ghana): BOLA branca/preta no centro com BANDEIRA DE GHANA (faixa verde/amarelo/vermelho + ESTRELA PRETA) curvada por cima + texto "GHANA FOOTBALL ASSOCIATION" em volta
    - BEL-1 (Royal Belgian FA): COROA preta+amarela no topo + escudo PRETO/AMARELO/VERMELHO (cores Bélgica) com letra "B" e texto "ROYAL BELGIAN FA · 1895" + RAMOS DE LOUROS embaixo
    - NED-1 (KNVB Holanda): LEÃO VERMELHO RAMPANTE no escudo branco, texto "KNVB" no topo do escudo
    - CAN-1 (Canada Soccer): FOLHA DE BORDO VERMELHA grande no topo + bola estilizada vermelha embaixo + texto "CANADA®" preto no centro, fundo branco circular
    - RSA-1 (SAFA África do Sul): retângulo BRANCO com DOIS elementos lado-a-lado — BOLA preto-e-branca de futebol à ESQUERDA e silhueta de MAPA DOURADO/MARROM (continente africano OU contorno da África do Sul) à DIREITA. Texto "FIFA WORLD CUP 2026" no topo em letras PRETAS. Logo "PANINI" amarelo embaixo. Fundo HOLOGRÁFICO/FOIL com cores PRISMÁTICAS brilhantes (vermelho/verde/azul/roxo). ⚠️ FÁCIL CONFUNDIR com FWC-0 "We are Panini" pelo fundo foil — MAS FWC-0 tem foto REAL de jogador chutando de bicicleta (sem bola+mapa). RSA-1 tem o gráfico abstrato bola+continente. Se ver bola+mapa juntos = RSA-1. Se ver foto de jogador chutando = FWC-0.
    - BRA-1 (CBF Brasil): ÓVALO/CÍRCULO BRANCO no centro com o ESCUDO CBF — escudo AZUL-MARINHO com CRUZ AMARELA (em X) + letras "CBF" brancas no centro dentro de quadradinho azul. CINCO ESTRELAS AMARELAS em arco no topo do escudo (5 títulos mundiais). Palavra "BRASIL" em letras VERDES bold embaixo do escudo. Faixas diagonais com cores do BRASIL (verde + amarelo + azul). Texto "FIFA WORLD CUP 2026" no topo em letras BRANCAS. Logo "PANINI" amarelo canto inferior direito. Fundo PRATA FOIL HOLOGRÁFICO com texto "Panini" repetido em padrão brilhante.
    - JOR-1 (JFA Jordânia): ESCUDO em formato de FLECHA/PONTA pra cima com fundo VERMELHO PROFUNDO. No topo, faixa retangular PRETA com texto "JORDAN" em LETRAS BRANCAS maiúsculas. No centro do escudo, ESTRELA BRANCA GRANDE de 7 PONTAS (mesma da bandeira jordaniana). FIFA WORLD CUP 2026 no topo em letras claras + Panini canto inferior. Fundo FOIL HOLOGRÁFICO PRATA prismático.
    - PAR-1 (APF Paraguai): ESCUDO CIRCULAR com texto "APF" em letras PRETAS GRANDES à esquerda + linhas RADIAIS azul-marinho e vermelho (cores da bandeira paraguaia) saindo do centro. ESTRELA AMARELA grande no MEIO do escudo. Texto "PARAGUAY" em letras MAIÚSCULAS pretas à DIREITA do escudo (orientação vertical). Fundo FOIL HOLOGRÁFICO multicolor (vermelho/dourado/verde iridescente). FIFA WORLD CUP 2026 no topo + Panini canto inferior.
    - CZE-1 (FAČR Tchéquia/República Tcheca): CÍRCULO BRANCO grande no centro contendo um ESCUDO MEDIEVAL VERMELHO ESCURO (formato de escudo de armas com curvas). Dentro do escudo: LEÃO BRANCO/PRATA RAMPANTE (em pé sobre as patas traseiras, virado pra esquerda) com a CARACTERÍSTICA ÚNICA do leão tcheco — DUAS CAUDAS (não é uma só, são DUAS — único no mundo do futebol). O leão tem COROA DOURADA pequena na cabeça, garras estendidas e LÍNGUA VERMELHA pra fora. Acima do escudo, dentro do círculo branco, há uma faixa horizontal estreita com os 3 traços nas cores da bandeira tcheca (branco/vermelho/azul). Fundo da figurinha: VERMELHO ESCURO/BORGONHA (vinho) com listras diagonais sutis. Texto "FIFA WORLD CUP 2026" no topo em letras BRANCAS. Logo "PANINI" amarelo no canto inferior direito.
       ⚠️ NÃO CONFUNDIR com:
         • SFA Escócia (também tem leão rampante mas tem 1 cauda + escudo vermelho com leão vermelho ou cores diferentes)
         • Leões em outros badges (FA Inglaterra tem 3 leões deitados, NÃO em pé com cauda dupla)
       🎯 SINAL VISUAL ÚNICO: leão BRANCO com DUAS caudas em escudo VERMELHO em fundo CÍRCULO BRANCO em fundo VERMELHO BORGONHA = CZE-1.
- {PAIS}-13: TEAM PHOTO. Layout fixo:
    📸 PARTE SUPERIOR (~70% da figurinha): FOTO DO TIME INTEIRO posando em
       campo (fileira/duas fileiras de 18+ jogadores em pé/agachados com
       camisa nacional, em estádio).
    🏷️ FAIXA INFERIOR (~30% da figurinha): RÓTULO "WE ARE [PAÍS]" sobre
       fundo COLORIDO (cor da bandeira nacional). 3 elementos da esquerda
       pra direita:
         a) "WE ARE" em letras BRANCAS pequenas (canto inferior esquerdo)
         b) BANDEIRA do país (formato bandeira normal — NÃO é a bandeira-bola)
         c) NOME DO PAÍS em letras BRANCAS GRANDES MAIÚSCULAS
            (canto inferior direito) — ex: "SAUDI ARABIA", "JORDAN",
            "BRAZIL", "MEXICO", "ARGENTINA", "FRANCE", "JAPAN",
            "NETHERLANDS", "PORTUGAL"
    🎯 IDENTIFICAÇÃO: o NOME DO PAÍS escrito grande no canto inferior
       direito é a FONTE PRIMÁRIA de identificação. LEIA literalmente.
       NÃO infira por uniforme do time.
    Cores típicas da faixa inferior (pra confirmar visualmente):
       SAUDI ARABIA = VERDE; JORDAN = VERMELHO escuro; NETHERLANDS = LARANJA;
       BRAZIL = AMARELO/VERDE; ARGENTINA = AZUL-CELESTE; PORTUGAL = VERMELHO/VERDE;
       FRANCE = AZUL com listras; ITALY = AZUL escuro; MEXICO = VERDE;
       USA = AZUL com estrelas; JAPAN = AZUL com vermelho; CROATIA = XADREZ vermelho/branco;
       BELGIUM = preto/amarelo/vermelho; GERMANY = preto/vermelho/amarelo
    ⚠️ NÃO CONFUNDA paises com cores parecidas — sempre LEIA o texto:
       JORDAN (vermelho escuro) ≠ NETHERLANDS (laranja) ≠ MOROCCO (verde+vermelho);
       BRAZIL (amarelo) ≠ COLOMBIA (amarelo+azul+vermelho);
       PORTUGAL (vermelho+verde) ≠ MOROCCO ≠ ITALY (azul);
       SAUDI ARABIA (verde) ≠ MEXICO ≠ NIGERIA.
    player_name = "Team Photo", country = código do país (KSA, JOR, NED, BRA...).

Seção FIFA WORLD CUP (FWC-0 a FWC-19) — country sempre = "FIFA":
- FWC-0: "We are Panini" — figurinha FOIL/HOLOGRÁFICA com fundo prismático colorido (efeito brilhoso multicor), foto de jogador real chutando de bicicleta, logo "PANINI" amarelo embaixo. ⚠️ O álbum físico imprime "00" no rótulo do slot dessa figurinha (não "FWC-0"). Se ver "00" no slot, é FWC-0. Quando user digita/fala "00" sozinho, também é FWC-0.
- FWC-1: "Taça Oficial (parte de cima)" — figurinha FOIL/HOLOGRÁFICA PRATA mostrando a PARTE SUPERIOR da taça FIFA (estatueta DOURADA com a figura humana segurando o globo dourado no topo, mais o pescoço da taça). Recorte da metade de CIMA da taça. Fundo prata holográfico com padrão Panini repetido. SEM texto colorido visível na frente — só a estatueta dourada destacada no foil.
- FWC-2: "Taça Oficial (parte de baixo)" — figurinha FOIL/HOLOGRÁFICA PRATA mostrando a PARTE INFERIOR da taça FIFA (base DOURADA cilíndrica + braço da taça subindo). Recorte da metade de BAIXO, complementa visualmente FWC-1. Mesmo fundo prata holográfico. Texto "FIFA WORLD CUP" pode aparecer gravado na base dourada.
- ⚠️ FWC-1 + FWC-2 juntas formam a taça inteira — se a foto mostrar a taça INTEIRA verticalmente e for HOLOGRÁFICA prata, pode ter capturado as duas em uma só imagem (verifique se há divisória ou se são 2 cromos colados lado a lado).
- FWC-3: "Mascote Oficial" — DESENHO CARTOON ANIMADO (não foto real) dos 3 MASCOTES JUNTOS: ZAYU (lhama amarela/vermelha com poncho), MAPLE (alce vermelho), CLUTCH (águia careca branco-preta). Posando juntos em estilo cartoon. ⚠️ Se NÃO tem mascotes cartoon visíveis, NÃO é FWC-3.
- FWC-4: "Troféu Oficial" — figurinha FOIL/HOLOGRÁFICA com fundo PRISMÁTICO BRILHANTE multicolor (verde, azul, roxo, vermelho iridescente). Centro: TROFÉU ESTILIZADO em VERDE (silhueta/símbolo da taça FIFA em cor verde, NÃO a estatueta dourada detalhada da FWC-1/2). Texto "FIFA" pequeno no topo-esquerdo. Logo PANINI embaixo. ⚠️ NÃO confunda com: FWC-0 (We are Panini, tem jogador chutando bicicleta); FWC-1/2 (taça dourada partes, sem foil); FWC-6/7/8 (taça dourada em fundo cor sólida + "CAN MEX USA"). FWC-4 é a ÚNICA com troféu verde estilizado em fundo foil.
- FWC-5: "TRIONDA - Bola Oficial" — figurinha FOIL/HOLOGRÁFICA da bola TRIONDA: bola colorida (branca + azul + vermelha + verde) com logo FIFA visível na lateral, em campo gramado, fundo escuro com efeito brilhoso
- FWC-6: "Taça Canadá (fundo vermelho)" — TAÇA DOURADA da Copa em fundo VERMELHO + texto "FIFA WORLD CUP 2026 CAN MEX USA". É homenagem ao país-sede Canadá. NÃO é o escudo Canada Soccer (folha bordo).
- FWC-7: "Taça México (fundo verde)" — TAÇA DOURADA em fundo VERDE + texto "FIFA WORLD CUP 2026 CAN MEX USA". Homenagem ao México. NÃO é o escudo FMF.
- FWC-8: "Taça USA (fundo azul)" — TAÇA DOURADA em fundo AZUL + texto "FIFA WORLD CUP 2026 CAN MEX USA". Homenagem aos USA. NÃO é o escudo US Soccer.
- ⚠️ NÃO CONFUNDIR: FWC-1/2/4 também têm taça mas são fundos diferentes. FWC-6/7/8 SEMPRE têm fundo de cor sólida + texto "CAN MEX USA" embaixo da taça.
- FWC-9 a FWC-19: SÉRIE HISTÓRICA "FIFA MUSEUM". Cada figurinha é uma FOTO do time campeão posando em fileira (squad portrait). Embaixo tem uma FAIXA MARROM/VINHO ESCURO com: logo pequeno "FIFA MUSEUM" à ESQUERDA (texto branco + selo escuro) + NOME DO PAÍS em letras maiúsculas brancas grandes + ANO em branco na ponta direita. Bordas FOIL HOLOGRÁFICO PRATA com texto "Panini" repetido em padrão brilhante.
  - As CAMPEÃS ANTIGAS (FWC-9 Italy 1934, FWC-10 Brazil 1950, FWC-11 West Germany 1954) podem ter foto em P&B ou sépia (era do filme preto-e-branco). Não confunda essas com algo "errado" — é o registro histórico real.
  - As CAMPEÃS A PARTIR DE 1962 (FWC-12 em diante: Chile 1962, Germany 1974, Mexico 1986, USA 1994, Korea/Japan 2002, Germany 2006, Brazil 2014, Qatar 2022) são FOTO COLORIDA do squad.
  - player_name = "{Campeão} {Ano}". NÃO é nome de jogador.
  - Exemplos: "WEST GERMANY 1954" (P&B), "ARGENTINA 1986" (camisas listradas branco/azul-claro), "BRAZIL 1994" (amarelas), "ITALY 2006", "GERMANY 2014", "ARGENTINA 2022".

REGRA-CHAVE: se a figurinha não tem nome de jogador impresso embaixo, é um SÍMBOLO. Reconheça visualmente e use o rótulo da lista acima — NÃO inventa nome.

PANINI EXTRAS: figurinhas com selo vermelho "EXTRA STICKER" no canto superior direito E selo dourado circular "FIFA" no canto superior esquerdo são especiais (NÃO figurinhas normais de país). Pra essas:
  - country = "Extra"
  - tier pelo fundo: "ouro" (dourado brilhante), "prata" (prateado brilhante), "bronze" (marrom/cobre brilhante), "regular" (branco ou cor de time, sem brilho)
  - player_name normal (ex: "Erling Haaland")
  - number = "" (o código EXT-NN-TIER não aparece na frente)

COCA-COLA: figurinhas com fundo ESCURO (foto do jogador em ação, NÃO fundo branco de estúdio como cromo normal), nome do jogador escrito VERTICAL na lateral ESQUERDA em letras brancas maiúsculas, seguido do código de país entre parênteses (ex: "LAMINE YAMAL (ESP)", "FEDERICO VALVERDE (URU)"). Tem só o logo FIFA pequeno no canto superior esquerdo — SEM "PANINI", SEM "EXTRA STICKER". São 14 cromos (CC1-CC14). Pra essas:
  - country = "Coca" (NÃO o país entre parênteses — esse é só indicador)
  - player_name normal (ex: "Lamine Yamal", "Federico Valverde")
  - tier omitido
  - number = ""

Leia com cuidado. Não chute nomes. Ano (2010, 2019) e altura/peso (1.75, 68) NÃO são número da figurinha. Cada figurinha física = 1 entrada (duplicatas viram entradas separadas).

Retorne JSON:
{
  "scan_confidence": 0.9,
  "stickers": [
    {"number": "BRA-1", "player_name": "Emblem", "country": "Brasil", "status": "filled", "confidence": 0.95},
    {"player_name": "Erling Haaland", "country": "Extra", "tier": "ouro", "status": "filled", "confidence": 0.9},
    {"player_name": "Lamine Yamal", "country": "Coca", "status": "filled", "confidence": 0.92}
  ]
}`
}

// ── Matching helpers (same logic as /api/scan) ──

function normalizeName(name: string): string {
  return name
    .toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

type DbSticker = { id: number; number: string; player_name: string; country: string; type: string; section?: string; visual_hint?: string | null }
type ExtraTier = 'ouro' | 'prata' | 'bronze' | 'regular'

function fuzzyNameMatch(normTarget: string, stickers: DbSticker[]): DbSticker | null {
  const targetParts = normTarget.split(' ')
  const targetLast = targetParts[targetParts.length - 1]
  const targetFirst = targetParts[0]

  let best: DbSticker | null = null
  let bestScore = 0

  for (const s of stickers) {
    if (s.type !== 'player') continue
    const dbNorm = normalizeName(s.player_name)
    const dbParts = dbNorm.split(' ')
    const dbLast = dbParts[dbParts.length - 1]
    const dbFirst = dbParts[0]

    // Full contains
    if (normTarget.includes(dbNorm) || dbNorm.includes(normTarget)) {
      if (bestScore < 5) { best = s; bestScore = 5 }
    }
    // Exact last name
    if (targetLast === dbLast && targetLast.length >= 3) {
      if (bestScore < 3) { best = s; bestScore = 3 }
    }
    // First name match (single-name players: Neymar, Casemiro)
    if (targetFirst === dbFirst && targetFirst.length >= 4) {
      if (bestScore < 2) { best = s; bestScore = 2 }
    }
    // Cross-match first ↔ full
    if (targetFirst === dbNorm || dbFirst === normTarget) {
      if (bestScore < 3) { best = s; bestScore = 3 }
    }
  }

  return best
}

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  'brasil': 'BRA', 'brazil': 'BRA', 'argentina': 'ARG', 'franca': 'FRA', 'france': 'FRA',
  'portugal': 'POR', 'alemanha': 'GER', 'germany': 'GER', 'inglaterra': 'ENG', 'england': 'ENG',
  'espanha': 'ESP', 'spain': 'ESP', 'holanda': 'NED', 'netherlands': 'NED', 'japao': 'JPN',
  'japan': 'JPN', 'coreia': 'KOR', 'korea': 'KOR', 'marrocos': 'MAR', 'morocco': 'MAR',
  'croacia': 'CRO', 'croatia': 'CRO', 'belgica': 'BEL', 'belgium': 'BEL', 'canada': 'CAN',
  'mexico': 'MEX', 'uruguai': 'URU', 'uruguay': 'URU', 'suica': 'SUI', 'switzerland': 'SUI',
  'camaroes': 'CMR', 'cameroon': 'CMR', 'dinamarca': 'DEN', 'denmark': 'DEN', 'tunisia': 'TUN',
  'ira': 'IRN', 'iran': 'IRN', 'servia': 'SRB', 'serbia': 'SRB', 'gana': 'GHA', 'ghana': 'GHA',
  'catar': 'QAT', 'qatar': 'QAT', 'equador': 'ECU', 'ecuador': 'ECU', 'senegal': 'SEN',
  'gales': 'WAL', 'wales': 'WAL', 'australia': 'AUS', 'polonia': 'POL', 'poland': 'POL',
  'costa rica': 'CRC', 'arabia saudita': 'KSA', 'saudi arabia': 'KSA', 'eua': 'USA', 'fifa': 'FIFA',
  'curacao': 'CUW', 'curaçao': 'CUW', 'korsou': 'CUW',
}

// ── Module-level sticker cache for WhatsApp scan ──
let waCache: {
  stickers: DbSticker[]
  byNumber: Map<string, DbSticker>
  byCountry: Map<string, DbSticker[]>
  // PANINI Extras: 4 variants per player. Same isolation as web scan to avoid
  // collision with normal player matching.
  extrasByPlayer: Map<string, Map<ExtraTier, DbSticker>>
  // Coca-Cola: 14 stickers, share player names with country sections.
  cocaColaByPlayer: Map<string, DbSticker>
  // Pedro 2026-05-08: badge hints pra desambiguação de escudos no prompt.
  badgeHints: Array<{ number: string; country: string; visual_hint: string }>
  at: number
} | null = null
const WA_CACHE_TTL = 60 * 60 * 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getWaCache(db: any) {
  if (waCache && Date.now() - waCache.at < WA_CACHE_TTL) return waCache
  // Fetch in pages to avoid Supabase 1000-row default limit
  const [p1, p2] = await Promise.all([
    db.from('stickers').select('id, number, player_name, country, type, section, visual_hint').range(0, 999),
    db.from('stickers').select('id, number, player_name, country, type, section, visual_hint').range(1000, 1999),
  ])
  const data = [...(p1.data || []), ...(p2.data || [])]
  if (!data || data.length === 0) return null

  const stickers = data as DbSticker[]
  const byNumber = new Map(stickers.map((s: DbSticker) => [s.number.toUpperCase(), s]))
  const byCountry = new Map<string, DbSticker[]>()
  const extrasByPlayer = new Map<string, Map<ExtraTier, DbSticker>>()
  const cocaColaByPlayer = new Map<string, DbSticker>()

  const extrasNameRegex = /^(.*?)\s*\((Regular|Bronze|Prata|Ouro)\)\s*$/i
  const tierMap: Record<string, ExtraTier> = {
    regular: 'regular', bronze: 'bronze', prata: 'prata', ouro: 'ouro',
  }

  for (const s of stickers) {
    if (s.section === 'PANINI Extras') {
      const m = s.player_name.match(extrasNameRegex)
      if (m) {
        const normBare = normalizeName(m[1].trim())
        const tier = tierMap[m[2].toLowerCase()]
        if (!extrasByPlayer.has(normBare)) extrasByPlayer.set(normBare, new Map())
        extrasByPlayer.get(normBare)!.set(tier, s)
      }
      continue // keep extras out of byCountry
    }
    if (s.section === 'Coca-Cola') {
      cocaColaByPlayer.set(normalizeName(s.player_name), s)
      continue // keep Coca-Cola out of byCountry too
    }
    const code = s.number.split('-')[0]
    if (!byCountry.has(code)) byCountry.set(code, [])
    byCountry.get(code)!.push(s)
  }
  // Badge hints: só badges com visual_hint preenchido (Pedro 2026-05-08).
  const badgeHints = stickers
    .filter((s) => s.type === 'badge' && s.visual_hint)
    .map((s) => ({ number: s.number, country: s.country, visual_hint: s.visual_hint as string }))
  waCache = { stickers, byNumber, byCountry, extrasByPlayer, cocaColaByPlayer, badgeHints, at: Date.now() }
  console.log(`[WhatsApp scan] Cached ${stickers.length} stickers (${extrasByPlayer.size} extras players, ${cocaColaByPlayer.size} coca-cola)`)
  return waCache
}

function matchSticker(
  detected: { number?: string; player_name?: string; country?: string; tier?: string },
  cache: NonNullable<typeof waCache>
): DbSticker | null {
  const stickerNum = (detected.number || '').toUpperCase().trim()
  const playerName = detected.player_name || ''
  const country = (detected.country || '').trim()
  const normPlayer = normalizeName(playerName)
  const normCountry = normalizeName(country)

  // Priority 0a: Coca-Cola (country = "Coca").
  // Same isolation reasoning as Extras — CC players also exist in their
  // country sections, so we only route here when Gemini explicitly tags
  // "Coca". No country fallback — false positives would shadow the right one.
  const looksCoca = country.toUpperCase() === 'COCA' || normCountry === 'coca' || normCountry === 'cocacola' || normCountry === 'coca cola'
  if (looksCoca && normPlayer && normPlayer.length >= 2) {
    const exact = cache.cocaColaByPlayer.get(normPlayer)
    if (exact) return exact
    let foundNorm: string | null = null
    cache.cocaColaByPlayer.forEach((_, name) => {
      if (!foundNorm && (name.includes(normPlayer) || normPlayer.includes(name))) foundNorm = name
    })
    return foundNorm ? cache.cocaColaByPlayer.get(foundNorm) || null : null
  }

  // Priority 0b: PANINI Extras (country = "Extra" + tier).
  // Distinct path because extras live in a separate section with 4 variants.
  // No fallback to country lookup — if we can't resolve the tier, return null
  // (avoids matching an Extra as the player's regular country sticker).
  const looksExtra = country.toUpperCase() === 'EXT' || normCountry === 'extra' || normCountry === 'extras'
  if (looksExtra && normPlayer && normPlayer.length >= 2) {
    const tierRaw = (detected.tier || '').toLowerCase().trim()
    const tier: ExtraTier =
      tierRaw === 'ouro' || tierRaw === 'gold' ? 'ouro' :
      tierRaw === 'prata' || tierRaw === 'silver' ? 'prata' :
      tierRaw === 'bronze' ? 'bronze' :
      'regular' // default when tier is missing or unrecognized
    const tiersForPlayer = cache.extrasByPlayer.get(normPlayer)
    if (tiersForPlayer) return tiersForPlayer.get(tier) || null
    // Fuzzy player match across extras
    let foundNorm: string | null = null
    cache.extrasByPlayer.forEach((_, name) => {
      if (!foundNorm && (name.includes(normPlayer) || normPlayer.includes(name))) foundNorm = name
    })
    if (foundNorm) {
      const fuzzyTiers = cache.extrasByPlayer.get(foundNorm)
      return fuzzyTiers?.get(tier) || null
    }
    return null
  }

  // Priority 1: exact number match
  if (stickerNum) {
    // Try as-is, then normalize separators
    const exact = cache.byNumber.get(stickerNum)
    if (exact) return exact
    const normalized = stickerNum.replace(/\s+/g, '-').replace(/\.+/g, '-').replace(/_+/g, '-').replace(/-+/g, '-')
    const norm = cache.byNumber.get(normalized)
    if (norm) return norm
    // "BRA10" → "BRA-10"
    const noSep = stickerNum.match(/^([A-Z]{2,5})(\d+)$/)
    if (noSep) {
      const found = cache.byNumber.get(`${noSep[1]}-${noSep[2]}`)
      if (found) return found
    }
  }

  // Priority 1.5: SYMBOL synonyms (Pedro 2026-05-03 caso Taciane)
  // Scanner devolve "Official Ball" / "World Cup Trophy" — mapeia pro número
  // canônico antes de tentar fuzzy de nome (que falharia).
  const symbolNumber = matchSymbolByName(playerName, country)
  if (symbolNumber) {
    const found = cache.byNumber.get(symbolNumber)
    if (found) return found
  }

  // Priority 2: name + country
  if (normPlayer && normPlayer.length >= 2) {
    // Resolve country code
    const normCountry = normalizeName(country)
    const code = COUNTRY_NAME_TO_CODE[normCountry] || COUNTRY_NAME_TO_CODE[country.toUpperCase()] || country.toUpperCase()
    const countryStickers = cache.byCountry.get(code)

    if (countryStickers) {
      // Exact name in country
      const exactName = countryStickers.find(s => normalizeName(s.player_name) === normPlayer)
      if (exactName) return exactName
      // Fuzzy in country
      const fuzzy = fuzzyNameMatch(normPlayer, countryStickers)
      if (fuzzy) return fuzzy
    }

    // Flat name search across all
    const exactFlat = cache.stickers.find(s => normalizeName(s.player_name) === normPlayer)
    if (exactFlat) return exactFlat

    // Fuzzy across all
    const fuzzyAll = fuzzyNameMatch(normPlayer, cache.stickers)
    if (fuzzyAll) return fuzzyAll
  }

  // Priority 3: special types (Emblem, Team Photo) + country
  if (normPlayer === 'emblem' || normPlayer === 'team photo') {
    const normCountry = normalizeName(country)
    const code = COUNTRY_NAME_TO_CODE[normCountry] || COUNTRY_NAME_TO_CODE[country.toUpperCase()] || country.toUpperCase()
    const countryStickers = cache.byCountry.get(code)
    if (countryStickers) {
      const typeMatch = normPlayer === 'emblem' ? 'badge' : 'player'
      const special = countryStickers.find(s =>
        normalizeName(s.player_name) === normPlayer ||
        (s.type === typeMatch) ||
        (normPlayer === 'emblem' && s.player_name.toLowerCase().includes('emblem')) ||
        (normPlayer === 'team photo' && s.player_name.toLowerCase().includes('team photo'))
      )
      if (special) return special
    }
  }

  return null
}

export async function POST(req: NextRequest) {
  let phone = ''
  try {
    const body = await req.json()
    const { base64, mimeType, userId } = body
    phone = body.phone || ''
    // Pedro 2026-05-06 (caso +55 67 98112-1341): user mandou foto + caption
    // "Eu tenho alguma dessas?". Bot tratou como register em vez de consultar.
    // Webhook agora passa mode='query' quando detecta caption de pergunta.
    // Default 'register' preserva 100% comportamento anterior.
    const mode: 'register' | 'query' = body.mode === 'query' ? 'query' : 'register'

    if (!base64 || !phone || !userId) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Verify internal secret
    const secret = req.headers.get('x-internal-secret')
    if (secret !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminDb = getAdmin()

    // Check scan limit
    // Pedro 2026-05-06 (caso Marina): ANTES caia em fallback 'free' silencioso
    // se a query falhasse (race/timeout/RLS), gerando paywall errado pra user
    // pagante. Agora: erro NÃO assume free — avisa user pra tentar de novo.
    const { data: profile, error: profileError } = await adminDb
      .from('profiles')
      .select('tier')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      console.error('[whatsapp/scan] profile fetch failed for user', userId, profileError?.message)
      await sendText(phone, '⚠️ Não consegui validar sua conta agora. Manda a foto de novo em uns segundos, por favor!')
      return NextResponse.json({ ok: true })
    }

    const userTier = (profile.tier || 'free') as Tier
    const tierScanLimit = getScanLimit(userTier)

    const { data: usageData } = await adminDb
      .rpc('increment_scan_usage', {
        p_user_id: userId,
        p_daily_limit: tierScanLimit,
      })

    if (usageData && !usageData.allowed) {
      // Mensagem em escada (Pedro 2026-05-02): se ainda tem áudio, sugere
      // áudio. Senão, texto. Sempre mostra opções de upgrade válidas.
      const quotas = await getQuotas(userId, userTier)
      const msg = buildPaywallMessage(APP_URL, 'scan', quotas)
      await sendText(phone, msg)
      return NextResponse.json({ ok: true })
    }

    // Load sticker cache
    const cache = await getWaCache(adminDb)
    if (!cache) {
      await sendText(phone, 'Erro ao carregar figurinhas. Tenta de novo! 📸')
      return NextResponse.json({ ok: true })
    }

    // Scan with Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const models = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash-001',
    ]
    let responseText = ''

    const isRetryable = (msg: string) =>
      msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('Too Many') || msg.includes('404') || msg.includes('not found') ||
      msg.includes('deprecated') || msg.includes('503') || msg.includes('UNAVAILABLE') ||
      msg.includes('500') || msg.includes('INTERNAL')

    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: buildScanInstruction(cache?.badgeHints ?? []),
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        })

        const result = await model.generateContent([
          { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64 } },
          { text: 'Identifique TODAS as figurinhas nesta foto — jogadores, emblemas, escudos, fotos de time. Leia o nome EXATO de cada jogador. Retorne JSON.' },
        ])
        responseText = result.response.text()
        console.log(`[WhatsApp scan] ${modelName} succeeded`)
        break
      } catch (modelErr) {
        const msg = modelErr instanceof Error ? modelErr.message : String(modelErr)
        console.error(`[WhatsApp scan] ${modelName} failed:`, msg.substring(0, 200))
        if (isRetryable(msg)) continue
        throw modelErr
      }
    }

    if (!responseText) {
      await sendText(phone, 'O serviço de scan está ocupado. Tenta de novo em 1 minuto ou use o scan pelo site! 🌐\n\n' + APP_URL + '/scan')
      return NextResponse.json({ ok: true })
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      // Pedro 2026-05-04: 0 figurinhas → não cobra scan
      await adminDb.rpc('decrement_scan_usage', { p_user_id: userId })
      await sendText(phone, 'Não encontrei figurinhas nessa foto. Tenta uma com mais nitidez! 📸 (não contou scan)')
      return NextResponse.json({ ok: true })
    }

    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.stickers || !Array.isArray(parsed.stickers) || parsed.stickers.length === 0) {
      // Pedro 2026-05-04: 0 figurinhas → não cobra scan
      await adminDb.rpc('decrement_scan_usage', { p_user_id: userId })
      await sendText(phone, 'Não encontrei figurinhas nessa foto. Tenta uma com mais nitidez! 📸 (não contou scan)')
      return NextResponse.json({ ok: true })
    }

    // Keep filled stickers; ALSO keep backs (face='back') even if Gemini
    // mistakenly marked them as 'empty' — backs are physical stickers,
    // they just lack the colored player photo by design.
    const filledStickers = parsed.stickers.filter((s: { status: string; face?: string }) => {
      if (s.status === 'filled') return true
      if ((s.face || '').toLowerCase() === 'back') return true
      return false
    })

    if (filledStickers.length === 0) {
      // Pedro 2026-05-04: só vimos slots vazios → não cobra scan
      await adminDb.rpc('decrement_scan_usage', { p_user_id: userId })
      await sendText(phone, 'Não encontrei figurinhas coladas nessa foto. Tenta outra! 📸 (não contou scan)')
      return NextResponse.json({ ok: true })
    }

    // Gap detection: Gemini was asked to count BEFORE listing. If it counted
    // more cromos than it listed, it pulled a "skipped" — surface to user
    // so they can re-scan the missed sticker isolated.
    const reportedTotal = typeof parsed.total_stickers_visible === 'number' ? parsed.total_stickers_visible : 0
    const skippedCount = Math.max(0, reportedTotal - filledStickers.length)
    if (skippedCount > 0) {
      console.log(`[WhatsApp scan] gap detected: total=${reportedTotal}, listed=${filledStickers.length}, skipped=${skippedCount}`)
    }

    // Soft warning quando passa de 10 cromos: processa normalmente mas
    // adiciona aviso ao final dizendo que a assertividade cai. Pedro
    // confirmou que vale tentar ler mais, só com transparência sobre
    // o trade-off.
    const overLimit = filledStickers.length > 10

    // Match each detected sticker using fuzzy matching (with quantity tracking).
    // Also keep the WORST confidence reported by Gemini for each sticker_id so
    // we can flag low-confidence items in the preview ("⚠️ confira").
    const stickerQty = new Map<number, { sticker: DbSticker; qty: number; minConfidence: number }>()
    const unmatchedNames: string[] = []

    for (const detected of filledStickers as Array<{ player_name?: string; country?: string; number?: string; confidence?: number; tier?: string }>) {
      const matched = matchSticker(detected, cache)
      const conf = typeof detected.confidence === 'number' ? detected.confidence : 1
      if (matched) {
        const existing = stickerQty.get(matched.id)
        if (existing) {
          existing.qty += 1
          if (conf < existing.minConfidence) existing.minConfidence = conf
        } else {
          stickerQty.set(matched.id, { sticker: matched, qty: 1, minConfidence: conf })
        }
        console.log(`[WhatsApp scan] ✓ "${detected.player_name}" (${detected.country}) → ${matched.number} ${matched.player_name} [conf=${conf.toFixed(2)}]`)
      } else {
        const label = detected.player_name || detected.number || '?'
        unmatchedNames.push(label)
        console.log(`[WhatsApp scan] ✗ "${detected.player_name}" (${detected.country}) → no match`)
      }
    }

    const dbStickers = Array.from(stickerQty.values())

    if (dbStickers.length === 0) {
      const names = unmatchedNames.slice(0, 5).join(', ')
      await sendText(phone, `Encontrei figurinha(s) mas não consegui identificar no banco: ${names}. Tenta pelo site! 📸\n\n${APP_URL}/scan`)
      return NextResponse.json({ ok: true })
    }

    // Check which ones user already has
    const { data: existing } = await adminDb
      .from('user_stickers')
      .select('sticker_id, status, quantity')
      .eq('user_id', userId)
      .in('sticker_id', dbStickers.map((s) => s.sticker.id))

    const existingMap = new Map((existing || []).map((e) => [e.sticker_id, e]))

    // Build preview list — numbered so the user can remove specific items
    // (e.g. "tirar 3" or "tirar 2,5") without canceling the whole batch.
    //
    // Pedro 2026-05-06: SEPARADO em duas seções (Novas / Já tinha) pra UX.
    // Antes vinha misturado (1. 🆕 ... 2. 🔁 ... 3. 🆕 ...) o que dificultava
    // o user enxergar quais figurinhas REALMENTE somavam ao álbum vs já
    // estavam coladas. Os índices (1, 2, 3...) seguem a ordem que veio do
    // OCR pra preservar "tirar N", mas a apresentação agrupa as duas listas.
    const newLines: string[] = []
    const repeatLines: string[] = []
    const scanData: Array<{ sticker_id: number; number: string; player_name: string; quantity: number }> = []

    const LOW_CONFIDENCE_THRESHOLD = 0.8
    let lowConfidenceCount = 0

    dbStickers.forEach(({ sticker, qty, minConfidence }, idx) => {
      const ex = existingMap.get(sticker.id)
      const label = `${sticker.number} ${sticker.player_name || ''}`.trim()
      const qtyLabel = qty > 1 ? ` (x${qty})` : ''
      const n = idx + 1
      const lowConf = minConfidence < LOW_CONFIDENCE_THRESHOLD
      if (lowConf) lowConfidenceCount++
      const warn = lowConf ? ' ⚠️' : ''

      // status='missing' OU quantity=0 → trata como nova (consistente
      // com batchSaveStickers que faz o mesmo).
      const isNew = !ex || ex.status === 'missing' || ex.quantity === 0
      if (isNew) {
        newLines.push(`*${n}.* ${label}${qtyLabel}${warn}`)
      } else if (ex.status === 'owned') {
        repeatLines.push(`*${n}.* ${label}${qtyLabel} _(repetida)_${warn}`)
      } else if (ex.status === 'duplicate') {
        repeatLines.push(`*${n}.* ${label}${qtyLabel} _(rep x${ex.quantity + qty})_${warn}`)
      }

      scanData.push({ sticker_id: sticker.id, number: sticker.number, player_name: sticker.player_name || '', quantity: qty })
    })

    // Compose preview com seções
    const previewLines: string[] = []
    if (newLines.length > 0) {
      previewLines.push(`🆕 *Novas (${newLines.length}):*`)
      previewLines.push(...newLines)
    }
    if (repeatLines.length > 0) {
      if (previewLines.length > 0) previewLines.push('') // separador visual
      previewLines.push(`🔁 *Já tinha (${repeatLines.length}):*`)
      previewLines.push(...repeatLines)
    }

    // Pedro 2026-05-06: branch QUERY MODE — user só quer saber quais
    // dessas tem/não tem. Não cria pending, não pede SIM/NÃO. Resposta
    // direta no formato consulta (✅ tem / ❌ não tem).
    if (mode === 'query') {
      type Found = { number: string; player_name: string; status: string; quantity: number }
      const have: Found[] = []
      const missing: Array<{ number: string; player_name: string }> = []
      for (const { sticker } of dbStickers) {
        const ex = existingMap.get(sticker.id)
        // status='missing' ou quantity=0 → trata como "não tem"
        if (!ex || ex.status === 'missing' || ex.quantity === 0) {
          missing.push({ number: sticker.number, player_name: sticker.player_name || '' })
        } else {
          have.push({
            number: sticker.number,
            player_name: sticker.player_name || '',
            status: ex.status,
            quantity: ex.quantity,
          })
        }
      }

      const lines: string[] = []
      lines.push(`🔍 *Identifiquei ${dbStickers.length} figurinha(s) na foto:*\n`)
      if (missing.length > 0) {
        lines.push(`❌ *Você AINDA NÃO TEM ${missing.length}:*`)
        for (const s of missing) lines.push(`• ${s.number}${s.player_name ? ' ' + s.player_name : ''}`)
      }
      if (have.length > 0) {
        if (missing.length > 0) lines.push('')
        lines.push(`✅ *Você JÁ TEM ${have.length}:*`)
        for (const item of have) {
          const tag = item.status === 'duplicate' && item.quantity > 1
            ? ` _(rep x${item.quantity})_`
            : item.status === 'owned' ? ` _(1 cópia)_` : ''
          lines.push(`• ${item.number}${item.player_name ? ' ' + item.player_name : ''}${tag}`)
        }
      }
      lines.push('')
      lines.push(`💡 _Pra registrar (colar) essas no álbum, manda a foto sem caption — ou descreve com texto._`)

      await sendText(phone, lines.join('\n'))
      return NextResponse.json({ ok: true })
    }

    // Save pending scan (expires in 1 hour — DB default)
    // Pedro 2026-05-04: source=photo pra mensagem agregada agrupar por origem
    await adminDb.from('pending_scans').insert({
      user_id: userId,
      phone,
      scan_data: scanData,
      source: 'photo',
    })

    // Check how many total pending scans this user has now
    const { count: pendingCount } = await adminDb
      .from('pending_scans')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())

    const totalPending = pendingCount || 1
    const totalStickersFound = dbStickers.reduce((sum, s) => sum + s.qty, 0)

    // Build message — different wording for first scan vs subsequent
    const lowConfNote = lowConfidenceCount > 0
      ? `\n\n⚠️ _${lowConfidenceCount} item(s) com baixa confiança — confira antes de salvar. Use *tirar N* se algum estiver errado._`
      : ''
    const gapNote = skippedCount > 0
      ? `\n\n🚨 _Vi *${reportedTotal} figurinhas* na foto mas só identifiquei ${filledStickers.length}. ${skippedCount} cromo(s) podem ter passado batido — confira a foto e mande de novo só o(s) que ficou(aram) de fora._`
      : ''
    const overLimitNote = overLimit
      ? `\n\n📸 _Foto com *${filledStickers.length} cromos* — passou do recomendado (10). A assertividade cai bastante; confira tudo antes de salvar e use *tirar N* pra remover erros._`
      : ''

    // Pedro 2026-05-03 (caso Joao Gabriel): user respondeu "TIRAR N" achando
    // que era o comando literal. E quando tem 1 item só, oferecer TIRAR
    // confunde mais que ajuda. Adapta conforme totalStickersFound.
    const exampleN = Math.min(totalStickersFound, 3)
    let msg: string
    if (totalPending === 1) {
      msg = `📋 *Encontrei ${totalStickersFound} figurinha(s):*\n\n`
      msg += previewLines.join('\n')
      msg += lowConfNote
      msg += gapNote
      msg += overLimitNote
      msg += '\n\n💡 Pode mandar mais fotos! Quando terminar:'
      msg += totalStickersFound === 1 ? '\n✅ *SIM* → registra' : '\n✅ *SIM* → registra tudo'
      if (totalStickersFound >= 2) {
        msg += `\n✏️ *TIRAR ${exampleN}* → remove o item ${exampleN} (vale também: _tirar 2,5_)`
      }
      msg += '\n❌ *NÃO* → cancela'
      msg += '\n\n⏰ _Expira em 1h se não responder_'
    } else {
      msg = `📋 *+${totalStickersFound} figurinha(s) detectada(s):*\n\n`
      msg += previewLines.join('\n')
      msg += lowConfNote
      msg += gapNote
      msg += overLimitNote
      msg += `\n\n📦 *${totalPending} fotos pendentes no total.*`
      msg += '\nMande mais fotos ou responda:'
      msg += '\n✅ *SIM* → registra todas'
      if (totalStickersFound >= 2) {
        msg += `\n✏️ *TIRAR ${exampleN}* → remove o item ${exampleN} desta foto (_tirar 2,5_)`
      }
      msg += '\n❌ *NÃO* → cancela todas'
    }

    await sendText(phone, msg)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[WhatsApp scan] Error:', errMsg)
    if (phone) {
      const isQuota = errMsg.includes('429') || errMsg.includes('quota')
      const userMsg = isQuota
        ? 'O serviço de scan está sobrecarregado. Tenta de novo mais tarde ou use o scan pelo site! 🌐\n\n' + APP_URL + '/scan'
        : 'Não consegui analisar essa foto. Tenta com mais nitidez! 📸'
      await sendText(phone, userMsg).catch(() => {})
    }
    return NextResponse.json({ error: 'scan failed' }, { status: 500 })
  }
}
