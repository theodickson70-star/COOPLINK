# CoopLink

Mfumo wa kisasa wa kusimamia **Vyama vya Msingi (AMCOS)** vya tumbaku.
**Mradi mmoja · repo moja · service moja ya Railway.**

## Mfumo umejengwaje?

```
 ┌────────────────────────────── Railway (service MOJA) ──────────────────────────────┐
 │                                                                                    │
 │   Kivinjari ──►  https://cooplink.up.railway.app                                   │
 │                    │                                                               │
 │                    ├── /            → Admin Web (React)   ← folda  admin/          │
 │                    ├── /api/v1/...  → API (Node/Express)  ← folda  src/            │
 │                    └── /health      → ukaguzi wa Railway                           │
 │                                   │                                                │
 │                                   ▼                                                │
 │                           PostgreSQL (Railway au Supabase)                         │
 └────────────────────────────────────────────────────────────────────────────────────┘
```

- **`src/`** ni backend (API). Inashughulikia kuingia, ruhusa, wanachama, pembejeo, ledger ya fedha, na audit.
- **`admin/`** ni kurasa za wavuti (React) ambazo Katibu, Mhasibu na Karani wanatumia, zikiwa na logo, rangi na tone ya CoopLink.
- **`drizzle/`** ni migrations za database (muundo wa meza zote).
- **`railway.json`** inamwambia Railway jinsi ya kujenga na kuwasha mfumo. Hakuna cha kuweka kwa mkono.

`npm run build` inajenga backend **na** admin kwa pamoja. Baada ya hapo `npm start` inawasha server moja inayotoa API na kurasa za admin kwenye anwani ile ile.

## Kuendesha kwenye kompyuta yako (Windows / PowerShell)

```powershell
npm run setup                 # inasakinisha backend + admin
copy .env.example .env        # jaza DATABASE_URL, DIRECT_URL, JWT_SECRET
npm run db:migrate            # kutengeneza meza
npm run db:seed               # SUPER_ADMIN kutoka SEED_ADMIN_PHONE / SEED_ADMIN_PASSWORD (.env)
```

Kisha fungua **terminal mbili**:

```powershell
npm run dev          # terminal 1: API  → http://localhost:4000
npm run dev:admin    # terminal 2: Admin → http://localhost:5173
```

Data ya majaribio: `$env:SEED_DEMO="true"; npm run db:seed`. Kisha ingia kama Katibu kwa `0711000001` / `Demo12345`.

## Kuweka kwenye Railway

1. Push repo hii GitHub (amri ziko chini).
2. Railway → **New Project → Deploy from GitHub repo** → chagua `cooplink`.
3. Kwenye project hiyo hiyo: **+ New → Database → PostgreSQL**. (Au tumia Supabase.)
4. Service ya `cooplink` → **Variables**, weka:

   | Variable | Thamani |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway) au URL ya Supabase pooler |
   | `DIRECT_URL` | sawa na `DATABASE_URL` (Railway) au Supabase direct (5432) |
   | `DB_SSL` | `false` kwa Railway Postgres, `true` kwa Supabase |
   | `JWT_SECRET` | herufi 48+ za siri (tazama `.env.example`) |
   | `NODE_ENV` | `production` |

5. **Settings → Networking → Generate Domain**.
6. Railway itajenga kila kitu, itaendesha migrations yenyewe kabla ya kuwasha (`preDeployCommand`), na itakagua `/health`.
7. **SUPER_ADMIN** — weka kwenye Variables: `SEED_ADMIN_PHONE` (namba yako), `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_RESET_PASSWORD=true`, `SEED_ADMIN_SINGLE=true`. Kila deploy, Railway inaendesha `npm run release` (migrations + seed) **kabla** ya kuwasha. Seed inabadilisha SUPER_ADMIN **aliyepo** (haiundi wa pili, haifuti data), kisha inathibitisha login. Ikishindwa, deploy inasimama na toleo la zamani linaendelea.
   - Baada ya kuingia na kubadilisha nenosiri, **futa** `SEED_ADMIN_PASSWORD` na `SEED_ADMIN_RESET_PASSWORD`, la sivyo deploy ijayo italirudisha nenosiri la Variables.

Kila mara utakapo-push GitHub, Railway itadeploy yenyewe.

## Amri muhimu

| Amri | Kazi |
|---|---|
| `npm run setup` | Kusakinisha kila kitu |
| `npm run dev` / `npm run dev:admin` | Kuendesha kwa ajili ya kutengeneza |
| `npm run build` | Kujenga API + admin |
| `npm start` | Kuwasha (production) |
| `npm run db:migrate` | Kuendesha migrations |
| `npm run db:generate -- --name jina` | Kutengeneza migration baada ya kubadilisha `src/db/schema.ts` |
| `npm test` | Majaribio ya API (tumia DB ya majaribio, si ya production) |

## Kanuni za msingi (zisivunjwe)

1. **Multi-tenant.** Kila chama kinaona data yake tu (`src/middleware/tenant.ts`).
2. **Ledger haibadilishwi.** Fedha za mwanachama zinaandikwa kupitia `src/lib/ledger.ts`. Kosa linasahihishwa kwa REVERSAL, na database yenyewe inazuia kufuta au kubadilisha rekodi.
3. **Pesa si float.** Hesabu zote zinatumia `numeric` na `decimal.js`.
4. **Kila kitendo kinaandikwa kwenye audit log.**
5. **Mwanachama hafutwi.** Hali yake inabadilishwa tu.

## Owner Control Panel (v0.2.0)

SUPER_ADMIN (Owner) akiingia anapelekwa `/owner`. Sehemu 11: Owner Dashboard, AMCOS Management, Subscriptions & Pricing,
Finance & Revenue, Staff Management, System Control Center, Marketing & Communication, Security & Audit, Backup & Database,
NAYA Group Business na Owner Settings. Kitufe "Mwonekano wa Vyama" kinarudisha upande wa vyama.

- **Wafanyakazi wa NAYA GROUP** (Finance Manager, Tech Support, Customer Support, Marketing Manager) wanaundwa kwenye Staff Management.
  Ruhusa zinakaguliwa kwenye backend (`src/lib/permissions.ts`). Hawaoni data za wanachama wala fedha za vyama.
- **Hatua nyeti** (kuthibitisha/kurudisha malipo, kusitisha chama, kuongeza muda, maintenance, export, restore) zinaomba nenosiri tena, na msimbo wa 2FA kama umewashwa.
- **Malipo ya CoopLink** yanaanza "Inasubiri" na hayawi "Imethibitishwa" bila Owner/Finance kuthibitisha. Mapato ya CoopLink hayachanganywi na fedha za vyama.
- **Subscription ikiisha** (baada ya siku za grace), chama kinasitishwa kiotomatiki na kinarudishwa malipo yakithibitishwa (kazi ya kila saa).
- **Backup halisi** zinachukuliwa na Railway. Mfumo haufanyi restore wala kufuta database wenyewe.

Vigezo vya ziada (hiari) kwenye Railway: `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` (SMS kupitia Africa's Talking). Bila hivyo SMS zinarekodiwa kama "Imerukwa".

## Brand

Rangi ni Msitu `#0B2F23`, Kijani `#1F7A52`, Jani `#2FA36B`, Dhahabu `#E3A83A` na Krimu `#F6F0E1`. Herufi ni Outfit na Inter.
Logo iko `admin/src/components/Logo.tsx` na `admin/public/logo.svg`. Tone iko `admin/public/cooplink-tone.mp3`.

## Hatua zinazofuata

- **Awamu 2:** masoko (mabelo, madaraja, bei USD), makato, malipo ya M-Pesa na benki, SMS. Meza zake tayari ziko kwenye `src/db/schema.ts`.
- **Awamu 3:** USSD kwa wanachama, dashibodi ya Union, na app ya Flutter (offline) kwa makarani.
