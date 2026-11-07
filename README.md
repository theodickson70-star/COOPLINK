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
7. Weka `SEED_ADMIN_PHONE` (namba yako) na, kwa mara ya kwanza, `SEED_ADMIN_PASSWORD`. Kisha endesha `npm run db:seed:prod` kwenye **Railway Shell**. Ingia, kisha **badilisha nenosiri** mara moja.
   - Seed ni salama kuendesha mara nyingi. Ukibadilisha `SEED_ADMIN_PHONE`, inabadilisha namba ya SUPER_ADMIN **aliyepo**, haiundi wa pili, na data nyingine zote zinabaki.
   - Kubadilisha nenosiri kupitia Railway: weka `SEED_ADMIN_PASSWORD` mpya pamoja na `SEED_ADMIN_RESET_PASSWORD=true`, endesha seed, kisha **futa vigezo hivyo viwili**.

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

## Brand

Rangi ni Msitu `#0B2F23`, Kijani `#1F7A52`, Jani `#2FA36B`, Dhahabu `#E3A83A` na Krimu `#F6F0E1`. Herufi ni Outfit na Inter.
Logo iko `admin/src/components/Logo.tsx` na `admin/public/logo.svg`. Tone iko `admin/public/cooplink-tone.mp3`.

## Hatua zinazofuata

- **Awamu 2:** masoko (mabelo, madaraja, bei USD), makato, malipo ya M-Pesa na benki, SMS. Meza zake tayari ziko kwenye `src/db/schema.ts`.
- **Awamu 3:** USSD kwa wanachama, dashibodi ya Union, na app ya Flutter (offline) kwa makarani.
