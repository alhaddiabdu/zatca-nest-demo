# خطة التنفيذ: أوضاع التشغيل الثلاثة + PostgreSQL

> الفرع: `main` · كُتبت بتاريخ 2026-10-12 · الحالة: بانتظار الموافقة على الأسئلة في القسم 5

> **⚠️ ملاحظة مهمة: كل العمل يكون على الفرع `main` فقط.**
> - لا تُنشأ أي فروع أخرى (لا feature ولا غيرها).
> - كل خطوة تُحفظ بـ commit محلي مباشرة على `main`.
> - بعد نجاح كل خطوة و commit الخاص بها، يُرفع `main` إلى GitHub (`git push origin main`).

## 1) مقدمة

**الوضع الحالي.** خادم NestJS 10 في `src/zatca` يغطي الخطوات الـ 11 لربط فاتورة، وواجهة React 18 + Vite في `frontend`. البيئة تُحدَّد مرة واحدة من متغير `ZATCA_ENV` عند الإقلاع. بيانات البائع والـ EGS تأتي من متغيرات `SELLER_*` و `EGS_*` في `.env`. كل الحالة (المفتاح الخاص، الشهادات، ICV/PIH، المعلّق) في ملف JSON واحد `data/egs-<env>.json` بنص صريح. الفواتير ملفات XML في `data/invoices/`. سجل الفواتير في الواجهة محفوظ في `localStorage` فقط. الحماية من التزامن طابور Promise داخل العملية الواحدة.

**ما سيتغير.**
- الوضع النشط يُختار من الواجهة ويُحفظ في قاعدة البيانات، ولكل وضع إعداداته ومفتاحه وشهاداته وسلسلته المستقلة.
- PostgreSQL 16 عبر TypeORM مع migrations، والمفتاح الخاص و secret و binarySecurityToken مشفّرة بـ AES-256-GCM.
- السلسلة تُحدَّث داخل transaction مع `SELECT ... FOR UPDATE`، فتصبح آمنة مع أكثر من نسخة.
- الفواتير المعلّقة صف بحالة `PENDING` يعيد إرسالها مُجدوِل كل 5 دقائق بتأخير تصاعدي.
- واجهة جديدة: شاشة اختيار الوضع، إعدادات المنشأة، لوحة تحكم، وجدول فواتير من الخادم.

**المخاطر.**
1. **فقدان `MASTER_KEY` = فقدان المفاتيح الخاصة** لكل الأوضاع، ويلزم إعادة التسجيل. يجب حفظ نسخة منه خارج الخادم.
2. **الترحيل من JSON**: خطأ في نقل ICV/PIH يكسر السلسلة لدى الهيئة. السكربت يرفض الكتابة فوق وضع فيه فواتير، ويُختبر على نسخة أولاً.
3. **الملفات المجمّدة** (`crypto/*` و `xml/*`): أي تغيير عرضي فيها يُبطل التحقق السابق. الخطوة 1 تضيف فحصاً آلياً يمنع ذلك.
4. **ملاحظة على التجميد**: تقرير المراجعة السابق رصد نقاطاً داخل هذه الملفات (SigningTime بصيغة UTC مع `Z`، تقريب PriceAmount، الوسم 9 في QR القياسية). الخطة لا تلمسها التزاماً بالقيد؛ انظر السؤال 12.
5. **الوضع النشط عام لكل المستخدمين**: تغييره من متصفح يغيّره للجميع.
6. **لا اتصال بالهيئة أثناء التطوير**: لذلك يُضاف ناقل وهمي محلي (الخطوة 10)، وإلا لا يمكن تجربة التسجيل والإرسال يدوياً.

### قيود ملزمة أثناء التنفيذ

- ممنوع تعديل منطق `src/zatca/crypto/*` و `src/zatca/xml/*`. المسموح فقط تغيير طريقة استدعائها وما يُمرَّر لها. `npm run check:frozen` يجب أن ينجح بعد كل خطوة.
- `src/zatca/xml/invoice-builder.ts` و `scripts/offline-demo.ts` يستوردان النوع `SellerInfo` من `src/zatca/zatca.config.ts`، فيجب أن يبقى هذا التصدير بنفس الشكل. وكذلك `ZATCA_BASE_URLS` و `CERT_TEMPLATE_NAMES`.
- لا طلبات لخوادم الهيئة أثناء التطوير والاختبار: `ZATCA_TRANSPORT=fake` في كل بيئات التطوير، والاختبارات لا تستخدم الناقل الحقيقي أبداً.
- كل العمل على الفرع `main` مباشرة (لا فروع أخرى)، و commit لكل خطوة، ثم رفع `main` إلى GitHub بعد كل خطوة ناجحة.
- لا `synchronize: true` في أي مكان، حتى في الاختبارات.

---

## 2) قرارات التصميم

### 2.1 هيكل الجداول

الأسماء بصيغة snake_case. كل الأوقات `timestamptz`. المعرّف `env` قيمته واحدة من: `developer-portal` · `simulation` · `core`.

#### `app_settings` — صف واحد فقط

| العمود | النوع | القيود |
| --- | --- | --- |
| id | smallint | PK، default 1، `CHECK (id = 1)` |
| active_env | varchar(20) | NULL = لم يُختر وضع بعد (أول فتح)، FK → environments(env) |
| core_confirmed_at | timestamptz | NULL، وقت آخر تأكيد بكلمة CORE |
| updated_at | timestamptz | NOT NULL default now() |

#### `environments` — صف لكل وضع (3 صفوف تُزرع في الـ migration)

| العمود | النوع | القيود |
| --- | --- | --- |
| env | varchar(20) | PK، `CHECK (env IN ('developer-portal','simulation','core'))` |
| seller_name | varchar(200) | NULL |
| seller_vat_number | char(15) | NULL، `CHECK (seller_vat_number ~ '^3[0-9]{13}3$')` |
| seller_crn | varchar(10) | NULL، `CHECK (~ '^[0-9]{10}$')` |
| seller_street | varchar(200) | NULL |
| seller_building_number | char(4) | NULL، `CHECK (~ '^[0-9]{4}$')` |
| seller_district | varchar(100) | NULL |
| seller_city | varchar(100) | NULL |
| seller_postal_code | char(5) | NULL، `CHECK (~ '^[0-9]{5}$')` |
| egs_common_name | varchar(64) | NULL |
| egs_org_unit | varchar(64) | NULL |
| egs_solution_name | varchar(64) | NULL |
| egs_model | varchar(64) | NULL |
| egs_serial | varchar(64) | NULL |
| egs_invoice_type | char(4) | NULL، `CHECK (egs_invoice_type IN ('1100','1000','0100'))` |
| egs_location | varchar(64) | NULL |
| egs_industry | varchar(64) | NULL |
| private_key_enc | text | NULL، مشفّر |
| csr_pem | text | NULL (ليس سرّياً) |
| compliance_token_enc | text | NULL، مشفّر |
| compliance_secret_enc | text | NULL، مشفّر |
| compliance_request_id | varchar(64) | NULL |
| production_token_enc | text | NULL، مشفّر |
| production_secret_enc | text | NULL، مشفّر |
| production_request_id | varchar(64) | NULL |
| production_cert_not_after | timestamptz | NULL، تاريخ انتهاء الشهادة (يُقرأ منها عند الحفظ) |
| onboarded_at | timestamptz | NULL |
| chain_epoch | integer | NOT NULL default 1 |
| icv | bigint | NOT NULL default 0، `CHECK (icv >= 0)` |
| pih | text | NOT NULL default قيمة `INITIAL_PIH` |
| local_test_key_enc | text | NULL، مشفّر (مفتاح dryRun) |
| local_test_cert_pem | text | NULL |
| created_at / updated_at | timestamptz | NOT NULL default now() |

**حالة البطاقة مشتقة، لا تُخزَّن:** `onboarded` إذا `production_token_enc IS NOT NULL`، وإلا `configured` إذا كانت كل حقول seller_* و egs_* غير فارغة، وإلا `unconfigured`.

**البذور:** صف `developer-portal` يُملأ بالقيم التجريبية الحالية الموجودة في `zatca.config.ts` (شركة التجربة المحدودة، 399999999900003، TST-886431145-399999999900003...). صفا `simulation` و `core` فارغان.

#### `invoices`

| العمود | النوع | القيود |
| --- | --- | --- |
| id | uuid | PK default `gen_random_uuid()` |
| env | varchar(20) | NOT NULL، FK → environments(env) |
| invoice_number | varchar(127) | NOT NULL (رقم الفاتورة الظاهر `cbc:ID`) |
| is_dry_run | boolean | NOT NULL default false |
| uuid | uuid | NOT NULL، UNIQUE |
| category | varchar(10) | NOT NULL، `CHECK IN ('standard','simplified')` |
| kind | varchar(10) | NOT NULL، `CHECK IN ('invoice','credit','debit')` |
| chain_epoch | integer | NULL (NULL للتجربة) |
| icv | bigint | NULL (NULL للتجربة) |
| pih | text | NULL |
| invoice_hash | text | NOT NULL |
| issue_date | date | NOT NULL |
| issue_time | varchar(8) | NOT NULL (يُحفظ نصاً كما في XML لتجنب تحويل المنطقة الزمنية) |
| buyer | jsonb | NULL |
| lines | jsonb | NOT NULL |
| payment_means_code | varchar(4) | NULL |
| original_invoice_id | varchar(127) | NULL |
| reason | text | NULL |
| net_amount / vat_amount / total_amount | numeric(18,2) | NULL (NULL للمستورد بلا تفاصيل) |
| status | varchar(30) | NOT NULL، `CHECK IN ('DRY_RUN','PENDING','ACCEPTED','ACCEPTED_WITH_WARNINGS','REJECTED')` |
| submission_channel | varchar(10) | NULL، `CHECK IN ('reporting','clearance')` |
| http_status | smallint | NULL، آخر رد |
| zatca_response | jsonb | NULL، آخر رد كما هو |
| signed_xml | text | NOT NULL |
| cleared_xml | text | NULL (الفاتورة المختومة من الاعتماد) |
| qr | text | NOT NULL (نص TLV Base64) |
| attempts | integer | NOT NULL default 0 |
| next_retry_at | timestamptz | NULL |
| last_error | text | NULL |
| submitted_at | timestamptz | NULL، وقت آخر رد نهائي |
| created_at / updated_at | timestamptz | NOT NULL default now() |

الفهارس:
- `UNIQUE (env, invoice_number) WHERE NOT is_dry_run` — المطلوب "unique على البيئة + رقم الفاتورة". فواتير التجربة مستثناة حتى لا تحجز الأرقام.
- `UNIQUE (env, chain_epoch, icv) WHERE icv IS NOT NULL` — يمنع تكرار العداد حتى لو حدث خطأ في القفل.
- `INDEX (env, status, created_at DESC)` — للوحة والجدول.
- `INDEX (next_retry_at) WHERE status = 'PENDING'` — للمُجدوِل.

ملاحظة TypeORM: أعمدة `numeric` تعود نصوصاً، فيُضاف transformer يحوّلها لأرقام.

#### `compliance_checks`

| العمود | النوع | القيود |
| --- | --- | --- |
| id | bigserial | PK |
| env | varchar(20) | NOT NULL، FK → environments(env) |
| run_id | uuid | NOT NULL (محاولة التسجيل الواحدة) |
| document | varchar(30) | NOT NULL، مثل `standard-invoice` |
| icv | integer | NOT NULL |
| uuid | uuid | NOT NULL |
| invoice_hash | text | NOT NULL |
| http_status | smallint | NOT NULL |
| ok | boolean | NOT NULL |
| response | jsonb | NULL |
| created_at | timestamptz | NOT NULL default now() |

فهرس: `INDEX (env, run_id)`.

#### التشفير

- AES-256-GCM، مفتاح 32 بايت من `MASTER_KEY` (Base64، يُولَّد بـ `openssl rand -base64 32`).
- الصيغة المخزنة: `v1:<iv Base64>:<tag Base64>:<ciphertext Base64>`، و iv عشوائي 12 بايت لكل قيمة.
- AAD = `<env>:<اسم العمود>`، فلا يمكن نسخ قيمة مشفرة من عمود أو وضع إلى آخر.
- الإقلاع يتوقف (رمز خروج غير صفري) إذا كان `MASTER_KEY` مفقوداً أو لا يساوي 32 بايت بعد فك Base64.
- لا تُرجع أي endpoint قيمة مفكوكة، ولا تُكتب في السجلات.

### 2.2 الـ endpoints

كل المسارات تحت `/zatca`. المسارات التي تعمل على "الوضع النشط" ترجع `409 NO_ACTIVE_MODE` إذا لم يُختر وضع.

| الطريقة والمسار | المدخلات | المخرجات والأخطاء |
| --- | --- | --- |
| `GET /modes` | — | `{ active: Env \| null, modes: [{ env, label, color, state: 'unconfigured' \| 'configured' \| 'onboarded', onboardedAt, invoiceCount, pendingCount }] }` |
| `GET /mode` | — | `{ active: Env \| null }` |
| `PUT /mode` | `{ mode: Env, confirm?: string }` | 200 `{ active }` · 400 `CORE_CONFIRMATION_REQUIRED` إذا mode=core و confirm ≠ `"CORE"` حرفياً |
| `GET /environments/:env/settings` | — | `{ env, seller: {...}, egs: {...}, complete: boolean, missing: string[], lockedFields: string[] }` · 404 لوضع غير معروف |
| `PUT /environments/:env/settings` | `{ seller: {name, vatNumber, crn, street, buildingNumber, district, city, postalCode}, egs: {commonName, orgUnit, solutionName, model, serial, invoiceType, location, industry} }` | 200 نفس شكل GET · 400 قائمة أخطاء التحقق بالعربية · 409 `FIELDS_LOCKED` عند تغيير حقل مقفل بعد التسجيل |
| `GET /status` | — | الشكل الحالي للوضع النشط + `mode` و `countsByStatus` و `pendingOverdue` (مبسطة معلّقة أكثر من 24 ساعة) و `productionCertNotAfter` |
| `POST /onboard` | `{ otp?: string, force?: boolean }` | الشكل الحالي + `runId` · 400 `SETTINGS_INCOMPLETE` · 400 `OTP_REQUIRED` (محاكاة/إنتاج) · 409 `PENDING_EXISTS` · في بوابة المطورين يُستخدم `123345` إذا لم يُرسل otp |
| `POST /invoices?dryRun=true` | `CreateInvoiceDto` الحالي | الشكل الحالي + `invoiceId` (معرّف الصف) · 409 `DUPLICATE_INVOICE_NUMBER` |
| `POST /invoices/retry-pending` | — | `{ attempted, accepted, rejected, stillPending }` |
| `GET /invoices` | `env?` (الافتراضي النشط)، `status?`، `category?`، `kind?`، `q?` (رقم الفاتورة أو UUID)، `from?`، `to?` (تاريخ)، `includeDryRun?`، `page=1`، `pageSize=20` (حد أقصى 100) | `{ items: [{ id, invoiceNumber, category, kind, icv, status, totalAmount, httpStatus, attempts, nextRetryAt, createdAt }], total, page, pageSize }` |
| `GET /invoices/:id` | id = uuid الصف | كل الحقول + `qrImage` (Data URL يُولَّد عند القراءة) + `zatcaResponse`، دون الـ XML الكامل · 404 |
| `GET /invoices/:id/xml` | `version=signed\|cleared` | `application/xml` · 404 (يتغير معنى `:id` من رقم الفاتورة إلى معرّف الصف) |

**التحقق الصارم في الإعدادات** (`whitelist` + `forbidNonWhitelisted` على هذا المسار):
- `vatNumber` `^3\d{13}3$` · `crn` `^\d{10}$` · `buildingNumber` `^\d{4}$` · `postalCode` `^\d{5}$` · `invoiceType` واحد من `1100` / `1000` / `0100`.
- كل النصوص: مطلوبة، بعد trim، طول 1 إلى الحد في الجدول.
- **حقول الـ CSR** (`commonName`، `orgUnit`، `solutionName`، `model`، `serial`، `location`، `industry`، وكذلك `seller.name` و `vatNumber`) ترفض: الأسطر الجديدة، و `=`، و `|`، و `[` و `]`، و `$`. السبب أن `crypto/csr.ts` يكتبها حرفياً داخل ملف إعداد openssl، فسطر جديد فيها يحقن إعدادات.
- بعد التسجيل تُقفل حقول الـ CSR والرقم الضريبي (`lockedFields`)، وتغييرها يتطلب إعادة تسجيل. العنوان يبقى قابلاً للتعديل.

**تصنيف ردود الهيئة** (دالة واحدة `classifyResponse`):

| الرد | الحالة | السلسلة | إعادة المحاولة |
| --- | --- | --- | --- |
| 200 | ACCEPTED | تبقى | لا |
| 202 | ACCEPTED_WITH_WARNINGS | تبقى | لا |
| 303 (اعتماد) | يُعاد عبر الإبلاغ ثم يُصنف رده | — | — |
| 400 | REJECTED (يبقى الصف ولا يُحذف) | تبقى | لا |
| 401 / 403 | PENDING + `last_error` "مشكلة مصادقة" | تبقى | نعم (انظر السؤال 6) |
| 429 / 5xx | PENDING | تبقى | نعم |
| انقطاع / مهلة | PENDING | تبقى | نعم |

**التأخير التصاعدي:** بعد المحاولة رقم n يكون `next_retry_at = now() + min(5 دقائق × 2^(n-1), 6 ساعات)`. المُجدوِل يعمل كل 5 دقائق ويختار الصفوف المستحقة بـ `FOR UPDATE SKIP LOCKED` بحد 20 صفاً.

**تدفق الإصدار:**
1. transaction: `SELECT * FROM environments WHERE env=$1 FOR UPDATE` ← فحص تكرار الرقم ← icv+1 ← بناء وتوقيع (`buildInvoiceXml` + `signInvoice` كما هما) ← INSERT للصف بحالة `PENDING` و `next_retry_at = now()+5min` ← UPDATE لـ icv و pih ← COMMIT.
2. خارج الـ transaction: الإرسال، ثم UPDATE للصف حسب `classifyResponse`.
3. إذا توقفت العملية بين 1 و 2، يلتقط المُجدوِل الصف بعد 5 دقائق. وقيمة `next_retry_at` المبدئية تمنعه من التقاطه أثناء الإرسال الأول.

### 2.3 تدفق الشاشات

لا مكتبة توجيه جديدة. `App.tsx` يحمل حالة `screen` ويحددها من الخادم:

```
فتح الواجهة ← GET /zatca/mode
  active = null ──────────────► [اختر وضع التشغيل: 3 بطاقات]
  active = X ──► GET /environments/X/settings
                   complete = false ──► [إعدادات المنشأة]
                   complete = true ──► GET /status
                                        onboarded = false ──► [التسجيل]
                                        onboarded = true  ──► [لوحة التحكم]

[البطاقة] ── بوابة المطورين ──► PUT /mode ──► (الإعدادات معبّأة مسبقاً) ──► التسجيل (OTP 123345 تلقائي)
          ── المحاكاة ────────► PUT /mode ──► الإعدادات ──► التسجيل (OTP من بوابة فاتورة - المحاكاة)
          ── الإنتاج ─────────► نافذة "اكتب CORE" ──► PUT /mode {confirm:"CORE"} ──► الإعدادات ──► التسجيل

لوحة التحكم: تبويبات [نظرة عامة] [فاتورة جديدة] [الفواتير] [الإعدادات] [التسجيل]
الشريط العلوي (كل الشاشات بعد الاختيار): اسم الوضع بلونه + زر "تغيير الوضع" ← يعود لشاشة البطاقات
وضع الإنتاج: شريط أحمر دائم تحت الشريط العلوي "أنت في وضع الإنتاج — الفواتير رسمية"
```

الألوان: بوابة المطورين أخضر، المحاكاة برتقالي، الإنتاج أحمر. تُعرَّف متغيرات CSS في `:root` ونسختها الداكنة، مع تغيير `.badge.env-developer-portal` من الأزرق الحالي إلى الأخضر.

المكونات:
- **جديدة:** `ModeSelect.tsx`، `ConfirmCoreDialog.tsx`، `ModeBar.tsx`، `SettingsPage.tsx`، `Dashboard.tsx`، `InvoiceTable.tsx`، `InvoiceDetails.tsx`.
- **تُطوَّر ولا يُعاد كتابتها:** `Onboarding.tsx`، `InvoiceForm.tsx`، `InvoiceResult.tsx`، `App.tsx`، `api.ts`، `types.ts`، `format.ts`، `styles.css`.
- سجل `localStorage` الحالي يُستبدل بجدول الفواتير من الخادم.

### 2.4 الحزم الجديدة

| الحزمة | الإصدار | السبب |
| --- | --- | --- |
| @nestjs/typeorm | ^10.0.2 | التكامل مع Nest 10 |
| typeorm | ^0.3.20 | ORM و migrations |
| pg | ^8.13.1 | مشغّل PostgreSQL |
| @nestjs/schedule | ^4.1.2 | المُجدوِل (متوافق مع Nest 10) |
| @nestjs/testing (dev) | ^10.4.15 | اختبارات الوحدات والتكامل |
| supertest + @types/supertest (dev) | ^7.0.0 / ^6.0.2 | اختبار الـ endpoints |

الواجهة: لا حزم جديدة.

### 2.5 متغيرات البيئة بعد التغيير

- **جديدة:** `DATABASE_URL`، `MASTER_KEY`، `ZATCA_TRANSPORT` (`fake` أو `live`، الافتراضي `fake`)، `TEST_DATABASE_URL` (للاختبارات)، `POSTGRES_DB` و `POSTGRES_USER` و `POSTGRES_PASSWORD` (لخدمة postgres).
- **تُلغى بعد الترحيل:** `ZATCA_ENV`، `SELLER_*`، `EGS_*`، `DATA_DIR`. تبقى مقروءة فقط في سكربت الاستيراد وكمرحلة انتقالية حتى الخطوة 30.

---

## 3) الخطوات

### الخطوة 0: إنشاء الفرع وحفظ الخطة
- [x] الحالة
- **الهدف:** بدء العمل على فرع مستقل مع الخطة.
- **يعتمد على:** —
- **الملفات:** `docs/IMPLEMENTATION_PLAN.md`
- **التفاصيل:** إنشاء الفرع من `main` وحفظ هذا الملف فيه.
- **الأوامر:** (نُفّذت على فرع `feature/modes-postgres` ثم دُمج في `main` وحُذف الفرع) `git switch -c feature/modes-postgres` ثم `git add docs/IMPLEMENTATION_PLAN.md`
- **معيار القبول:** `git branch --show-current` يطبع `feature/modes-postgres`، و `npm run build && npm test` ينجحان.
- **رسالة الـ commit:** `docs: add implementation plan for modes and PostgreSQL`

### الخطوة 1: حارس الملفات المجمّدة
- [x] الحالة
- **الهدف:** فحص آلي يفشل إذا تغيّر أي ملف في `crypto/` أو `xml/`.
- **يعتمد على:** 0
- **الملفات:** `scripts/check-frozen.sh` (جديد)، `package.json` (سكربت `check:frozen`)
- **التفاصيل:** السكربت ينفّذ `git diff --exit-code ea4af78 -- src/zatca/crypto src/zatca/xml` (المقارنة مع أول commit وليس مع فرع، لأن العمل على main)، ويطبع رسالة عربية واضحة عند الفشل.
- **الأوامر:** `npm run check:frozen`
- **معيار القبول:** ينجح الآن. تعديل تجريبي غير محفوظ في `qr.ts` يجعله يفشل برمز خروج 1، ثم `git checkout` يعيده للنجاح.
- **رسالة الـ commit:** `chore: add guard against changes to frozen crypto/xml modules`

### الخطوة 2: خدمة PostgreSQL في docker-compose
- [x] الحالة
- **الهدف:** تشغيل postgres:16 محلياً دون أن يعتمد عليه التطبيق بعد.
- **يعتمد على:** 0
- **الملفات:** `docker-compose.yml`، `.env.example`
- **التفاصيل:** خدمة `postgres` بصورة `postgres:16-alpine`، volume باسم `pgdata`، و healthcheck بـ `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB` كل 5 ثوانٍ، والمنفذ `5433:5432` للتطوير المحلي. إضافة `POSTGRES_*` و `DATABASE_URL` و `TEST_DATABASE_URL` إلى `.env.example`. خدمة api لا تتغير بعد.
- **الأوامر:** `docker compose up -d postgres` ثم `docker compose ps`
- **معيار القبول:** `docker compose ps` يعرض postgres بحالة `healthy`، و `docker compose exec postgres psql -U <user> -d <db> -c 'select version()'` يطبع PostgreSQL 16.
- **رسالة الـ commit:** `chore(docker): add postgres 16 service with healthcheck`

### الخطوة 3: تثبيت TypeORM والاتصال بالقاعدة
- [x] الحالة
- **الهدف:** يتصل التطبيق بالقاعدة عند الإقلاع، دون أي جداول بعد.
- **يعتمد على:** 2
- **الملفات:** `package.json`، `package-lock.json`، `src/database/database.module.ts`، `src/database/data-source.ts`، `src/app.module.ts`
- **التفاصيل:** `TypeOrmModule.forRootAsync` من `DATABASE_URL`، مع `synchronize: false` و `migrationsRun: false` ومسار migrations `dist/database/migrations/*.js`. ملف `data-source.ts` للـ CLI يستخدم نفس الإعدادات. سكربتات npm: `migration:run`، `migration:revert`، `migration:show`، `migration:create`، `migration:generate` عبر `typeorm-ts-node-commonjs -d src/database/data-source.ts`.
- **الأوامر:** `npm install @nestjs/typeorm@^10.0.2 typeorm@^0.3.20 pg@^8.13.1`
- **معيار القبول:** `npm run build` ينجح. `npm run start` مع postgres يعمل ويطبع اتصالاً ناجحاً. إيقاف postgres يجعل الإقلاع يفشل برسالة اتصال. `npm run migration:show` يعمل بلا أخطاء. `npm test` ينجح.
- **رسالة الـ commit:** `feat(db): wire TypeORM with PostgreSQL (no synchronize)`

### الخطوة 4: migration جدولي environments و app_settings
- [x] الحالة
- **الهدف:** إنشاء الجدولين بالقيود الموصوفة في 2.1 مع البذور.
- **يعتمد على:** 3
- **الملفات:** `src/database/migrations/<ts>-CreateEnvironments.ts`
- **التفاصيل:** SQL صريح داخل `up` و `down`: الأعمدة والـ CHECK والـ FK، وصف `app_settings` بقيمة `active_env = NULL`، وثلاثة صفوف `environments` مع تعبئة `developer-portal` بالقيم التجريبية. قيمة `pih` الافتراضية تُكتب حرفياً كما في `INITIAL_PIH`.
- **الأوامر:** `npm run migration:run` ثم `npm run migration:revert` ثم `npm run migration:run`
- **معيار القبول:** `psql -c '\d environments'` يعرض الأعمدة والقيود. `select env, seller_name is not null from environments` يعطي 3 صفوف (true للمطورين فقط). إدخال `seller_vat_number = '123'` يفشل بـ CHECK. الـ revert ثم run يعملان دون أخطاء.
- **رسالة الـ commit:** `feat(db): migration for environments and app_settings with seeds`

### الخطوة 5: migration جدولي invoices و compliance_checks
- [x] الحالة
- **الهدف:** إنشاء الجدولين بالفهارس الجزئية.
- **يعتمد على:** 4
- **الملفات:** `src/database/migrations/<ts>-CreateInvoices.ts`
- **التفاصيل:** كما في 2.1، بما فيها `UNIQUE (env, invoice_number) WHERE NOT is_dry_run` و `UNIQUE (env, chain_epoch, icv) WHERE icv IS NOT NULL` وفهرس المُجدوِل.
- **الأوامر:** `npm run migration:run`
- **معيار القبول:** إدخال صفين بنفس `(env, invoice_number)` و `is_dry_run=false` يفشل. نفس الشيء مع `is_dry_run=true` ينجح. `\di` يعرض الفهارس الأربعة. الـ revert يعمل.
- **رسالة الـ commit:** `feat(db): migration for invoices and compliance_checks`

### الخطوة 6: كيانات TypeORM
- [x] الحالة
- **الهدف:** تعريف الكيانات الأربعة مطابقة للـ migrations دون استخدامها بعد.
- **يعتمد على:** 5
- **الملفات:** `src/database/entities/app-settings.entity.ts`، `environment.entity.ts`، `invoice.entity.ts`، `compliance-check.entity.ts`، `src/database/numeric.transformer.ts`، `src/database/database.module.ts`
- **التفاصيل:** أسماء الأعمدة صريحة (`name: 'seller_vat_number'`)، و transformer للـ numeric، وتسجيل الكيانات في الـ module.
- **الأوامر:** `npm run migration:generate -- src/database/migrations/Check` (للتحقق فقط ثم يُحذف الملف الناتج)
- **معيار القبول:** `npm run build` ينجح. أمر generate لا يجد فروقاً (No changes in database schema) = الكيانات مطابقة للـ migrations.
- **رسالة الـ commit:** `feat(db): add TypeORM entities matching migrations`

### الخطوة 7: خدمة التشفير
- [x] الحالة
- **الهدف:** تشفير وفك AES-256-GCM مع AAD.
- **يعتمد على:** 3
- **الملفات:** `src/security/crypto-box.service.ts`، `src/security/security.module.ts`، `test/crypto-box.spec.ts`
- **التفاصيل:** `encrypt(plain, aad)` و `decrypt(stored, aad)` بالصيغة `v1:iv:tag:ct`. فك قيمة بـ AAD مختلف أو بعد العبث بها يرمي خطأ. لا تسجيل للقيم.
- **الأوامر:** `npm test -- crypto-box`
- **معيار القبول:** الاختبارات تغطي: ذهاب وإياب، iv مختلف لكل تشفير، فشل عند تغيير بايت، فشل عند AAD مختلف، فشل بمفتاح آخر. كلها تنجح.
- **رسالة الـ commit:** `feat(security): AES-256-GCM crypto box with AAD`

### الخطوة 8: التحقق من متغيرات البيئة عند الإقلاع
- [x] الحالة
- **الهدف:** يتوقف التشغيل إذا لم يوجد `MASTER_KEY` صالح أو `DATABASE_URL`.
- **يعتمد على:** 7
- **الملفات:** `src/config/env.validation.ts`، `src/app.module.ts`، `src/zatca/zatca.config.ts`، `test/env.validation.spec.ts`
- **التفاصيل:** دالة `validate` في `ConfigModule.forRoot` تفحص `MASTER_KEY` (Base64 يُفك إلى 32 بايت)، و `DATABASE_URL`، و `ZATCA_TRANSPORT ∈ {fake, live}`. في `zatca.config.ts` تُضاف دالة `envProfile(env)` تعيد `baseUrl` و `certTemplateName`، مع إبقاء `SellerInfo` و `ZATCA_BASE_URLS` و `CERT_TEMPLATE_NAMES` كما هي.
- **الأوامر:** `npm run build && MASTER_KEY= node dist/main.js; echo $?`
- **معيار القبول:** الأمر يطبع رسالة "MASTER_KEY مفقود أو غير صالح" ورمز خروج غير صفري. مفتاح بطول 16 بايت يفشل كذلك. مع قيم صحيحة يقلع. `npm run check:frozen` ينجح.
- **رسالة الـ commit:** `feat(config): fail fast on missing MASTER_KEY and DATABASE_URL`

### الخطوة 9: ZatcaApiService يأخذ البيئة لكل طلب
- [x] الحالة
- **الهدف:** إزالة الاعتماد على بيئة ثابتة في الإقلاع من طبقة الـ API.
- **يعتمد على:** 8
- **الملفات:** `src/zatca/api/zatca-api.service.ts`، `src/zatca/onboarding.service.ts`، `src/zatca/invoice.service.ts`، `test/zatca-api.spec.ts`
- **التفاصيل:** كل دالة عامة تأخذ `env: ZatcaEnv` أولاً، و `request` يبني الرابط من `envProfile(env).baseUrl`. المستدعون الحاليون يمررون `this.config.env`، فلا يتغير السلوك. الترويسات والمسارات كما هي حرفياً.
- **الأوامر:** `npm test -- zatca-api`
- **معيار القبول:** اختبار مع `fetch` وهمي (jest.spyOn على `global.fetch`) يتحقق من الرابط لكل بيئة، ومن الترويسات `Accept-Version: V2` و `Clearance-Status` و `OTP` و Authorization. لا طلبات شبكة حقيقية.
- **رسالة الـ commit:** `refactor(api): pass target environment per ZATCA request`

### الخطوة 10: الناقل الوهمي FakeZatcaApiService
- [x] الحالة
- **الهدف:** تجربة التسجيل والإرسال كاملين محلياً دون الاتصال بالهيئة.
- **يعتمد على:** 9
- **الملفات:** `src/zatca/api/zatca-api.port.ts` (واجهة مشتركة)، `src/zatca/api/fake-zatca-api.service.ts`، `src/zatca/zatca.module.ts`، `test/fake-zatca-api.spec.ts`
- **التفاصيل:**
    - provider يختار الحقيقي أو الوهمي حسب `ZATCA_TRANSPORT`.
    - الوهمي ينشئ CA محلياً عند الإقلاع عبر openssl في مجلد مؤقت، ويوقّع الـ CSR المستلم بها. فتكون الشهادة لنفس مفتاح الـ EGS، ويعمل `signInvoice` و `getCertificateInfo` دون أي تعديل.
    - `binarySecurityToken` = Base64 لنص الشهادة، بنفس شكل رد الهيئة.
    - الردود: compliance ← 200 PASS، الإبلاغ ← 200 `REPORTED`، الاعتماد ← 200 `CLEARED` مع `clearedInvoice` = نفس XML.
    - حالات للتجربة حسب رقم الفاتورة: يحتوي `FAIL503` ← 503، `REJECT400` ← 400 مع errorMessages، `TIMEOUT` ← يرمي `ServiceUnavailableException`، `WARN202` ← 202 مع تحذير.
    - لا يُستورد أي شيء جديد داخل `crypto/`.
- **الأوامر:** `npm test -- fake-zatca`
- **معيار القبول:** الاختبار يولّد مفتاحاً و CSR بـ `generateKeyAndCsr`، ويطلب شهادة من الوهمي، ويوقّع فاتورة بـ `signInvoice`، ويتحقق من التوقيع بالمفتاح العام في الشهادة. الحالات الخاصة تعيد الرموز المتوقعة. `npm run check:frozen` ينجح.
- **رسالة الـ commit:** `feat(api): local fake ZATCA transport for development and tests`

### الخطوة 11: EnvironmentsService
- [x] الحالة
- **الهدف:** قراءة صف الوضع وكتابته مع التشفير وحساب حالته.
- **يعتمد على:** 6، 7
- **الملفات:** `src/zatca/environments/environments.service.ts`، `environments.module.ts`، `test/int/environments.int-spec.ts`، `jest.int.config.js`، `package.json` (سكربت `test:int`)
- **التفاصيل:** دوال `get(env)`، `getSecrets(env)` (تفك المفتاح والشهادات داخل الخدمة فقط)، `saveCredentials(env, {...})` تشفّر قبل الحفظ، `state(env)`، `missingSettings(env)`. اختبارات التكامل تعمل على `TEST_DATABASE_URL` وتشغّل الـ migrations قبلها.
- **الأوامر:** `docker compose exec postgres createdb -U <user> zatca_test` ثم `npm install -D @nestjs/testing@^10.4.15` ثم `npm run test:int`
- **معيار القبول:** بعد `saveCredentials` لا يحتوي العمود في `psql` على `BEGIN EC PRIVATE KEY` ويبدأ بـ `v1:`، و `getSecrets` يعيد القيمة الأصلية. `state` يعطي القيم الثلاث في السيناريوهات الثلاثة.
- **رسالة الـ commit:** `feat(env): environments service with encrypted credentials`

### الخطوة 12: إعدادات المنشأة — DTO و endpoints
- [x] الحالة
- **الهدف:** `GET` و `PUT /zatca/environments/:env/settings` بتحقق صارم.
- **يعتمد على:** 11
- **الملفات:** `src/zatca/environments/settings.dto.ts`، `environments.controller.ts`، `test/settings.dto.spec.ts`، `test/int/settings.int-spec.ts`
- **التفاصيل:** القواعد في 2.2، و `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` على هذا الـ controller فقط، والقفل بعد التسجيل (409). رسائل الأخطاء بالعربية.
- **الأوامر:** `npm install -D supertest@^7.0.0 @types/supertest@^6.0.2` ثم `npm test -- settings && npm run test:int -- settings`
- **معيار القبول:** حالات الاختبار: رقم ضريبي 14 رقماً ← 400؛ حقل إضافي ← 400؛ `orgUnit` فيه `\n` ← 400؛ `serial` فيه `|` ← 400؛ `invoiceType=1111` ← 400؛ إعدادات صحيحة ← 200 و `complete=true`؛ تغيير `vatNumber` لوضع مسجّل ← 409؛ تغيير الشارع لوضع مسجّل ← 200.
- **رسالة الـ commit:** `feat(api): environment settings endpoints with strict validation`

### الخطوة 13: ModeService و endpoints الوضع
- [x] الحالة
- **الهدف:** `GET /zatca/modes`، و `GET` و `PUT /zatca/mode` مع تأكيد CORE.
- **يعتمد على:** 11
- **الملفات:** `src/zatca/modes/mode.service.ts`، `modes.controller.ts`، `src/zatca/modes/active-env.ts`، `test/int/modes.int-spec.ts`
- **التفاصيل:** `ModeService.requireActive()` يعيد الوضع النشط، أو يرمي `409 NO_ACTIVE_MODE`. **مرحلة انتقالية حتى الخطوة 30:** إذا كان `active_env` فارغاً يُستخدم `ZATCA_ENV` إن وُجد، حتى تبقى الواجهة القديمة تعمل. `PUT /mode` يتطلب `confirm === "CORE"` حرفياً للإنتاج، ويحدّث `core_confirmed_at`. `/modes` يحسب العدادات باستعلام واحد `GROUP BY env, status`.
- **الأوامر:** `npm run test:int -- modes`
- **معيار القبول:** `PUT /mode {mode:'core'}` ← 400؛ `{mode:'core', confirm:'core'}` ← 400؛ `{mode:'core', confirm:'CORE'}` ← 200؛ `{mode:'xyz'}` ← 400؛ `/modes` يعيد 3 عناصر بحالاتها الصحيحة.
- **رسالة الـ commit:** `feat(api): operating mode selection with CORE confirmation`

### الخطوة 14: ربط التسجيل بقاعدة البيانات
- [x] الحالة
- **الهدف:** `POST /zatca/onboard` يعمل على الوضع النشط ويحفظ في القاعدة.
- **يعتمد على:** 10، 12، 13
- **الملفات:** `src/zatca/onboarding.service.ts`، `src/zatca/invoice.service.ts` (`productionSigner` و `localSigner` فقط)، `src/zatca/dto/create-invoice.dto.ts` (`otp` اختياري)، `test/int/onboarding.int-spec.ts`
- **التفاصيل:**
    - بيانات البائع والـ EGS من صف الوضع.
    - OTP الافتراضي `123345` في بوابة المطورين فقط. في المحاكاة والإنتاج OTP إلزامي (400 `OTP_REQUIRED`).
    - رفض بـ `409 PENDING_EXISTS` إذا وُجدت فواتير PENDING في هذا الوضع.
    - كل فحص امتثال يُحفظ في `compliance_checks` تحت `run_id`.
    - الشهادات والمفتاح تُحفظ مشفرة، مع قراءة `production_cert_not_after` من الشهادة.
    - `productionSigner` و `localSigner` يقرآن المفتاح والشهادة من القاعدة.
    - **مؤقتاً:** السلسلة والمعلّق ما زالا في `EgsStoreService` حتى الخطوة 17.
- **الأوامر:** `npm run test:int -- onboarding` (مع `ZATCA_TRANSPORT=fake`)
- **معيار القبول:** بعد التسجيل: الوضع `onboarded`، و 6 صفوف في `compliance_checks` كلها `ok=true`. وجود صف PENDING يجعل التسجيل يُرفض بـ 409. `POST /invoices?dryRun=true` يعمل. `npm run check:frozen` ينجح.
- **رسالة الـ commit:** `feat(onboarding): persist onboarding and compliance checks in PostgreSQL`

### الخطوة 15: ChainService مع FOR UPDATE
- [x] الحالة
- **الهدف:** حجز ICV/PIH وإدخال صف الفاتورة داخل transaction واحدة.
- **يعتمد على:** 11
- **الملفات:** `src/zatca/chain/chain.service.ts`، `test/int/chain.int-spec.ts`
- **التفاصيل:** `issueInChain(env, build: (icv, pih) => {signedXml, invoiceHash, qr, ...})`: transaction ← `SELECT ... FOR UPDATE` (عبر `lock: { mode: 'pessimistic_write' }`) ← فحص تكرار الرقم (409) ← استدعاء `build` ← INSERT الصف بحالة PENDING و `next_retry_at = now()+5min` ← UPDATE `icv` و `pih` ← COMMIT. أي خطأ يلغي كل شيء.
- **الأوامر:** `npm run test:int -- chain`
- **معيار القبول:** اختبار تزامن: 20 استدعاء متوازياً عبر `Promise.all` بـ DataSource فيه pool من 10 اتصالات، ينتج ICV من 1 إلى 20 بلا تكرار ولا فجوات. كل PIH يساوي hash الصف السابق. خطأ داخل `build` لا يغيّر `icv`.
- **رسالة الـ commit:** `feat(chain): transactional ICV/PIH reservation with row lock`

### الخطوة 16: دالة تصنيف ردود الهيئة
- [x] الحالة
- **الهدف:** دالة نقية واحدة تحدد الحالة وموعد إعادة المحاولة.
- **يعتمد على:** —
- **الملفات:** `src/zatca/submission/classify.ts`، `test/classify.spec.ts`
- **التفاصيل:** `classifyResponse({httpStatus | networkError, attempts, now})` ← `{status, nextRetryAt, lastError}` حسب الجدول في 2.2، و `backoff(n)` بالصيغة الموصوفة.
- **الأوامر:** `npm test -- classify`
- **معيار القبول:** اختبارات جدولية لكل رمز (200، 202، 400، 401، 429، 500، 503، انقطاع)، و `backoff(1)=5m`، `backoff(2)=10m`، `backoff(8)=6h` (الحد الأقصى).
- **رسالة الـ commit:** `feat(submission): response classification and exponential backoff`

### الخطوة 17: ربط إصدار الفاتورة بقاعدة البيانات
- [x] الحالة
- **الهدف:** `POST /zatca/invoices` يحفظ كل فاتورة في `invoices` ويستخدم ChainService.
- **يعتمد على:** 14، 15، 16
- **الملفات:** `src/zatca/invoice.service.ts`، `test/int/issue.int-spec.ts`
- **التفاصيل:**
    - الإصدار الفعلي: `issueInChain` ثم الإرسال خارج الـ transaction (مع 303 ← إبلاغ كما الآن)، ثم تحديث الصف عبر `classifyResponse`، وحفظ `cleared_xml` إن وُجد.
    - dryRun: صف بـ `is_dry_run=true` وحالة `DRY_RUN` و icv فارغ، دون لمس السلسلة.
    - الرد يحافظ على الحقول الحالية ويضيف `invoiceId`.
    - `buildInvoiceXml` و `signInvoice` يُستدعيان كما هما.
- **الأوامر:** `npm run test:int -- issue`
- **معيار القبول:** مع الناقل الوهمي: مبسطة ← ACCEPTED؛ قياسية ← ACCEPTED و `cleared_xml` محفوظ؛ رقم `FAIL503` ← PENDING و attempts=1؛ `REJECT400` ← REJECTED؛ رقم مكرر ← 409؛ dryRun لا يغيّر `icv`. `npm run check:frozen` ينجح.
- **رسالة الـ commit:** `feat(invoices): persist issued invoices and chain in PostgreSQL`

### الخطوة 18: إعادة إرسال المعلّق من القاعدة
- [x] الحالة
- **الهدف:** `POST /zatca/invoices/retry-pending` يعمل على الصفوف ولا يحذف المرفوض.
- **يعتمد على:** 17
- **الملفات:** `src/zatca/submission/retry.service.ts`، `src/zatca/invoice.service.ts`، `test/int/retry.int-spec.ts`
- **التفاصيل:** `retryDue(env?, {force})` يختار PENDING بـ `FOR UPDATE SKIP LOCKED LIMIT 20`، ويرسل `signed_xml` المحفوظ كما هو، ويحدّث الصف. الصف المرفوض يصبح REJECTED ويبقى في الجدول. الاستدعاء اليدوي يتجاهل `next_retry_at` (`force=true`).
- **الأوامر:** `npm run test:int -- retry`
- **معيار القبول:** صف PENDING ينجح عند إعادة المحاولة ← ACCEPTED و `cleared_xml` محفوظ للقياسية. صف يعود برد 400 ← REJECTED والصف موجود. استدعاءان متوازيان لا يرسلان نفس الصف مرتين (عداد الطلبات في الوهمي).
- **رسالة الـ commit:** `feat(retry): retry pending invoices from database without dropping rejections`

### الخطوة 19: الجدولة التلقائية
- [x] الحالة
- **الهدف:** إعادة الإرسال كل 5 دقائق بتأخير تصاعدي.
- **يعتمد على:** 18
- **الملفات:** `src/zatca/submission/retry.scheduler.ts`، `src/zatca/zatca.module.ts`، `src/app.module.ts`، `test/retry.scheduler.spec.ts`
- **التفاصيل:** `ScheduleModule.forRoot()` و `@Interval(5 * 60_000)` يستدعي `retryDue` لكل الأوضاع، مع قفل داخلي يمنع التداخل إذا طالت الدورة. متغير `RETRY_SCHEDULER_ENABLED` (افتراضياً true، و false في الاختبارات).
- **الأوامر:** `npm install @nestjs/schedule@^4.1.2` ثم `npm test -- retry.scheduler`
- **معيار القبول:** اختبار بمؤقتات jest الوهمية: الدورة تُستدعى كل 5 دقائق، ودورة طويلة لا تبدأ أخرى فوقها. يدوياً: فاتورة `FAIL503-1` تبقى PENDING، ثم بعد تغيير رقمها في القاعدة لرقم ناجح وتقديم `next_retry_at` تُقبل في الدورة التالية.
- **رسالة الـ commit:** `feat(retry): scheduled retries every 5 minutes with backoff`

### الخطوة 20: قائمة الفواتير وتفاصيلها
- [x] الحالة
- **الهدف:** `GET /zatca/invoices` و `GET /zatca/invoices/:id` و `GET /zatca/invoices/:id/xml`.
- **يعتمد على:** 17
- **الملفات:** `src/zatca/invoices/invoices.controller.ts`، `invoices-query.dto.ts`، `src/zatca/zatca.controller.ts` (نقل مسار XML)، `test/int/invoices-list.int-spec.ts`
- **التفاصيل:** الفلاتر والترقيم كما في 2.2، والترتيب `created_at DESC`. التفاصيل تولّد `qrImage` بـ `qrcode` عند القراءة. مسار XML يأخذ معرّف الصف و `version=signed|cleared`.
- **الأوامر:** `npm run test:int -- invoices-list`
- **معيار القبول:** 25 فاتورة ← الصفحة 2 بحجم 20 فيها 5 عناصر و `total=25`؛ فلترة `status=PENDING` تعيد المعلّق فقط؛ `pageSize=500` ← 400؛ معرّف غير موجود ← 404؛ XML المعتمد يُعاد بـ `application/xml`.
- **رسالة الـ commit:** `feat(api): invoice list with filters/pagination and invoice details`

### الخطوة 21: توسيع /zatca/status
- [x] الحالة
- **الهدف:** إحصاءات اللوحة في طلب واحد.
- **يعتمد على:** 17، 13
- **الملفات:** `src/zatca/onboarding.service.ts` (`status`)، `test/int/status.int-spec.ts`
- **التفاصيل:** إضافة `mode` و `countsByStatus` و `pendingOverdue` و `productionCertNotAfter` و `state`، مع إبقاء الحقول الحالية لتوافق الواجهة القديمة.
- **الأوامر:** `npm run test:int -- status`
- **معيار القبول:** بعد إصدار 2 مقبولة و 1 معلّقة: `countsByStatus = {ACCEPTED:2, PENDING:1, ...}` و `pendingCount=1`.
- **رسالة الـ commit:** `feat(api): status endpoint with per-status counts`

### الخطوة 22: سكربت استيراد البيانات القديمة
- [x] الحالة
- **الهدف:** نقل `data/egs-*.json` إلى القاعدة مرة واحدة.
- **يعتمد على:** 17
- **الملفات:** `scripts/import-json-state.ts`، `package.json` (سكربت `import:json`)، `test/int/import.int-spec.ts`
- **التفاصيل:**
    - لكل ملف `egs-<env>.json`: يشفّر المفتاح والشهادات ويكتبها في صف الوضع، وينقل `icv` و `pih` و `onboardedAt` و `localTest`.
    - كل عنصر في `pending` يصبح صف invoices بحالة PENDING (`signed_xml` من `xmlBase64`، والقيم غير المتوفرة NULL، و `lines = []`، و `next_retry_at = now()`).
    - بيانات البائع والـ EGS تُقرأ من `SELLER_*` و `EGS_*` إن وُجدت.
    - يرفض الكتابة إذا كان للوضع فواتير أو شهادة إنتاج، إلا مع `--force`. خيار `--dry-run` يطبع ما سيحدث دون كتابة.
    - لا يطبع أي قيمة سرية.
- **الأوامر:** `npm run import:json -- --dry-run` ثم `npm run import:json`
- **معيار القبول:** على نسخة من `data/` الحالية: الصف `developer-portal` يحمل `icv=0` و `local_test_key_enc` يبدأ بـ `v1:`. التشغيل الثاني يُرفض. اختبار بملف فيه pending ينشئ صف PENDING مطابقاً.
- **رسالة الـ commit:** `feat(scripts): import legacy JSON state into PostgreSQL`

### الخطوة 23: إزالة التخزين القديم
- [x] الحالة
- **الهدف:** حذف `EgsStoreService` وكل قراءة أو كتابة لملفات JSON و XML.
- **يعتمد على:** 18، 20، 22
- **الملفات:** حذف `src/zatca/storage/egs-store.service.ts`، و `src/zatca/zatca.module.ts`، و `src/zatca/zatca.config.ts` (إزالة `dataDir` و seller و egs من الإعداد العام مع إبقاء `SellerInfo`)
- **التفاصيل:** `runExclusive` لم يعد مطلوباً لأن القفل في القاعدة. `DATA_DIR` لا يُستخدم إلا في سكربت الاستيراد.
- **الأوامر:** `grep -rn "egs-store\|DATA_DIR\|writeFileSync" src` ثم `npm run build && npm test && npm run test:int`
- **معيار القبول:** `grep` لا يجد `egs-store` ولا `DATA_DIR` في `src`، ولا `writeFileSync` إلا للملفات المؤقتة لـ openssl في `crypto/csr.ts` (مجمّد) و `fake-zatca-api.service.ts` (تُحذف بعد الاستخدام). كل الاختبارات تنجح. `npm run check:frozen` ينجح. `npm run demo:offline` ما زال يعمل.
- **رسالة الـ commit:** `refactor: remove legacy JSON file storage`

### الخطوة 24: docker-compose للتطبيق مع القاعدة
- [x] الحالة
- **الهدف:** `docker compose up` يشغّل postgres ثم api بعد تطبيق الـ migrations.
- **يعتمد على:** 23
- **الملفات:** `docker-compose.yml`، `Dockerfile`، `src/database/database.module.ts`
- **التفاصيل:** `api` تعتمد على `postgres` بشرط `service_healthy`، و `migrationsRun: true` عند الإقلاع (انظر السؤال 7)، و `DATABASE_URL` يشير إلى `postgres:5432`، و `MASTER_KEY` من `.env`، و `ZATCA_TRANSPORT=fake` افتراضياً. حذف volume `zatca-data` القديم من الإعداد مع ملاحظة في README.
- **الأوامر:** `docker compose up -d --build` ثم `docker compose logs api | tail -20`
- **معيار القبول:** postgres `healthy` قبل بدء api. السجل يظهر تنفيذ الـ migrations ثم الإقلاع. `curl localhost:3010/zatca/modes` يعيد 3 أوضاع. حذف `MASTER_KEY` من `.env` يجعل api تتوقف وتعيد التشغيل برسالة واضحة.
- **رسالة الـ commit:** `chore(docker): run api against postgres with migrations on boot`

### الخطوة 25: أنواع وعميل API في الواجهة
- [x] الحالة
- **الهدف:** دعم الواجهات الجديدة في `types.ts` و `api.ts` دون تغيير الشاشات.
- **يعتمد على:** 20، 21
- **الملفات:** `frontend/src/types.ts`، `frontend/src/api.ts`، `frontend/src/format.ts`
- **التفاصيل:** أنواع `Mode` و `ModeInfo` و `EnvSettings` و `InvoiceSummary` و `InvoiceDetail` و `Page<T>`؛ دوال `modes` و `mode` و `setMode` و `settings` و `saveSettings` و `invoices(query)` و `invoice(id)` و `xmlUrl(id, version)`؛ رسائل لرموز الأخطاء الجديدة؛ `MODE_COLORS`.
- **الأوامر:** `cd frontend && npm run build`
- **معيار القبول:** البناء ينجح والواجهة الحالية تعمل كما هي.
- **رسالة الـ commit:** `feat(web): API client and types for modes, settings and invoices`

### الخطوة 26: ألوان الأوضاع والشريط العلوي
- [x] الحالة
- **الهدف:** شريط علوي بلون الوضع، وزر "تغيير الوضع"، وشريط أحمر دائم في الإنتاج.
- **يعتمد على:** 25
- **الملفات:** `frontend/src/ModeBar.tsx`، `frontend/src/App.tsx`، `frontend/src/styles.css`
- **التفاصيل:** متغيرات `--mode-dev` (أخضر) و `--mode-sim` (برتقالي) و `--mode-core` (أحمر) مع نسخها الداكنة، وتحديث `.badge.env-*`. الشريط الأحمر في الإنتاج لا يُغلق. زر "تغيير الوضع" لا يعمل حتى الخطوة 30.
- **الأوامر:** `cd frontend && npm run build && npm run dev`
- **معيار القبول:** بتغيير الوضع عبر `curl -X PUT .../zatca/mode` يتغير لون الشريط بعد التحديث، ويظهر الشريط الأحمر في `core` فقط. يعمل بالوضعين الفاتح والداكن.
- **رسالة الـ commit:** `feat(web): mode-colored top bar and permanent production warning`

### الخطوة 27: شاشة اختيار الوضع
- [x] الحالة
- **الهدف:** ثلاث بطاقات تعرض الحالة وعدد الفواتير.
- **يعتمد على:** 26
- **الملفات:** `frontend/src/ModeSelect.tsx`، `frontend/src/styles.css`
- **التفاصيل:** لكل بطاقة: العنوان بلون الوضع، والوصف ("تجربة حرة" / "بيانات المنشأة الحقيقية دون أثر رسمي" / "فواتير رسمية")، وشارة الحالة (غير مُعدّ / مُعدّ / مسجل)، وعدد الفواتير والمعلّق، وزر "اختيار". البطاقة النشطة مميزة. على عرض الهاتف تصبح البطاقات عموداً واحداً.
- **الأوامر:** `cd frontend && npm run build`
- **معيار القبول:** البيانات مطابقة لـ `GET /zatca/modes`، واختيار بوابة المطورين أو المحاكاة يرسل `PUT /mode`.
- **رسالة الـ commit:** `feat(web): mode selection screen with three cards`

### الخطوة 28: نافذة تأكيد الإنتاج
- [x] الحالة
- **الهدف:** لا يُفعَّل الإنتاج إلا بكتابة CORE.
- **يعتمد على:** 27
- **الملفات:** `frontend/src/ConfirmCoreDialog.tsx`، `frontend/src/ModeSelect.tsx`
- **التفاصيل:** عنصر `<dialog>` يشرح أن الفواتير رسمية وتُرسل للهيئة، وحقل نصي، وزر "تفعيل الإنتاج" معطّل حتى تطابق القيمة `CORE` حرفياً. يُغلق بـ Esc. خطأ الخادم يظهر داخل النافذة.
- **الأوامر:** `cd frontend && npm run build`
- **معيار القبول:** كتابة `core` أو `CORE ` تُبقي الزر معطلاً. `CORE` يفعّله ويرسل `confirm:"CORE"`، ثم يظهر الشريط الأحمر.
- **رسالة الـ commit:** `feat(web): typed CORE confirmation before enabling production`

### الخطوة 29: صفحة إعدادات المنشأة
- [x] الحالة
- **الهدف:** تعديل بيانات البائع والـ EGS لكل وضع.
- **يعتمد على:** 25
- **الملفات:** `frontend/src/SettingsPage.tsx`، `frontend/src/styles.css`
- **التفاصيل:** مجموعتان (المنشأة، وحدة الإصدار EGS) بنفس أنماط `fieldset` و `.field` الحالية. تحقق فوري مطابق لقواعد الخادم، وعرض أخطاء الخادم بجانب كل حقل. الحقول المقفلة معطلة مع شرح. في بوابة المطورين تظهر القيم التجريبية مع زر "استعادة القيم التجريبية". الحقول الرقمية `dir="ltr"`.
- **الأوامر:** `cd frontend && npm run build`
- **معيار القبول:** حفظ رقم ضريبي خاطئ يعرض الخطأ تحت الحقل دون إرسال. حفظ صحيح يعيد `complete=true`. الحقول المقفلة معطلة في وضع مسجّل.
- **رسالة الـ commit:** `feat(web): organization and EGS settings page`

### الخطوة 30: منسّق التدفق في App
- [ ] الحالة
- **الهدف:** الانتقال التلقائي: البطاقات ← الإعدادات ← التسجيل ← اللوحة.
- **يعتمد على:** 27، 28، 29
- **الملفات:** `frontend/src/App.tsx`، `src/zatca/modes/mode.service.ts` (إزالة الرجوع إلى `ZATCA_ENV`)
- **التفاصيل:** دالة `resolveScreen()` حسب المخطط في 2.3 تُستدعى عند الفتح وبعد كل اختيار أو حفظ أو تسجيل. "تغيير الوضع" يعرض البطاقات دون تغيير الوضع حتى يختار المستخدم. إزالة سجل `localStorage` (`HISTORY_KEY`). من هذه الخطوة يبدأ النظام دون وضع نشط.
- **الأوامر:** `docker compose exec postgres psql -U <user> -d <db> -c "update app_settings set active_env = null"` ثم `cd frontend && npm run dev`
- **معيار القبول:** مع `active_env = null` تظهر البطاقات. اختيار المحاكاة (فارغة) ← الإعدادات، ثم الحفظ ← التسجيل. اختيار بوابة المطورين المسجّلة ← اللوحة مباشرة.
- **رسالة الـ commit:** `feat(web): automatic flow from mode selection to dashboard`

### الخطوة 31: تطوير شاشة التسجيل
- [ ] الحالة
- **الهدف:** OTP تلقائي في بوابة المطورين، وطلب OTP في غيرها، ومنع إعادة التسجيل مع وجود معلّق.
- **يعتمد على:** 30
- **الملفات:** `frontend/src/Onboarding.tsx`
- **التفاصيل:** في بوابة المطورين يُخفى حقل OTP ويُرسل `123345` (انظر السؤال 2). في المحاكاة نص إرشادي لبوابة فاتورة للمحاكاة، وفي الإنتاج للبوابة الرسمية. رسالة واضحة لـ `PENDING_EXISTS` مع رابط للفواتير المعلقة. بعد النجاح ينتقل إلى اللوحة. جدول فحوصات الامتثال الحالي يبقى.
- **الأوامر:** `cd frontend && npm run build`
- **معيار القبول:** مع الناقل الوهمي: تسجيل بوابة المطورين بلا إدخال OTP ← 6 فحوصات ناجحة ← اللوحة. في المحاكاة يلزم إدخال 6 أرقام.
- **رسالة الـ commit:** `feat(web): mode-aware onboarding with automatic developer OTP`

### الخطوة 32: لوحة التحكم
- [ ] الحالة
- **الهدف:** حالة التسجيل، وآخر ICV، والأعداد حسب الحالة، والمعلّق.
- **يعتمد على:** 30، 21
- **الملفات:** `frontend/src/Dashboard.tsx`، `frontend/src/App.tsx`، `frontend/src/styles.css`
- **التفاصيل:** تطوير قسم `.status` الحالي إلى بطاقات: التسجيل وتاريخه، وانتهاء الشهادة، وآخر ICV، وعدد كل حالة (بالألوان الحالية `STATUS_TONES`)، والمعلّق مع زر "إعادة الإرسال الآن" وتنبيه للمبسطة المتأخرة أكثر من 24 ساعة. تبويبات: نظرة عامة، فاتورة جديدة، الفواتير، الإعدادات، التسجيل.
- **الأوامر:** `cd frontend && npm run build`
- **معيار القبول:** الأعداد مطابقة لـ `GET /zatca/status`. إعادة الإرسال تحدّث الأعداد.
- **رسالة الـ commit:** `feat(web): dashboard with registration state and invoice counts`

### الخطوة 33: جدول الفواتير
- [ ] الحالة
- **الهدف:** جدول من الخادم مع الفلترة والترقيم.
- **يعتمد على:** 32
- **الملفات:** `frontend/src/InvoiceTable.tsx`، `frontend/src/App.tsx`
- **التفاصيل:** يعتمد على جدول السجل الحالي في `App.tsx` (نفس الأعمدة والأنماط)، مع فلاتر الحالة والنوع والوثيقة والتاريخ والبحث، وخيار "إظهار فواتير التجربة"، وترقيم 20 لكل صفحة. أزرار "إشعار دائن/مدين" الحالية تبقى. الضغط على صف يفتح التفاصيل.
- **الأوامر:** `cd frontend && npm run build`
- **معيار القبول:** فلترة "معلّقة" تعرض المعلّق فقط. التنقل بين الصفحات يعمل. الفلاتر تبقى بعد فتح التفاصيل وإغلاقها.
- **رسالة الـ commit:** `feat(web): server-backed invoice table with filters and pagination`

### الخطوة 34: تفاصيل الفاتورة
- [ ] الحالة
- **الهدف:** عرض XML و QR ورد الهيئة لكل فاتورة.
- **يعتمد على:** 33
- **الملفات:** `frontend/src/InvoiceDetails.tsx`، `frontend/src/InvoiceResult.tsx`
- **التفاصيل:** يعيد استخدام أجزاء `InvoiceResult` (قائمة meta، أخطاء وتحذيرات الهيئة، صورة QR) بتحويلها لمكوّن يستقبل `InvoiceDetail`. تبويبات: ملخص، XML الموقّع، XML المعتمد (إن وجد)، رد الهيئة (JSON منسّق)، وللمعلّق: عدد المحاولات وموعد التالية وآخر خطأ.
- **الأوامر:** `cd frontend && npm run build`
- **معيار القبول:** فاتورة `REJECT400` تعرض أخطاء الهيئة. قياسية مقبولة تعرض XML المعتمد. XML يُعرض `dir="ltr"`.
- **رسالة الـ commit:** `feat(web): invoice details with XML, QR and ZATCA response`

### الخطوة 35: تطوير نموذج الفاتورة والنتيجة
- [ ] الحالة
- **الهدف:** النموذج يعمل على الوضع النشط ويربط النتيجة بالتفاصيل.
- **يعتمد على:** 34
- **الملفات:** `frontend/src/InvoiceForm.tsx`، `frontend/src/InvoiceResult.tsx`
- **التفاصيل:** زر الإرسال بلون الوضع، وفي الإنتاج نص الزر "إصدار فاتورة رسمية". رسالة لرقم مكرر (409). النتيجة تعرض رابط "فتح التفاصيل" بدل `xmlPath`. "تجربة فقط" تبقى كما هي.
- **الأوامر:** `cd frontend && npm run build`
- **معيار القبول:** إصدار فاتورة يظهر فوراً في الجدول. تكرار الرقم يعرض الرسالة العربية. dryRun لا يغيّر ICV في اللوحة.
- **رسالة الـ commit:** `feat(web): mode-aware invoice form linked to invoice details`

### الخطوة 36: التوثيق
- [ ] الحالة
- **الهدف:** تحديث README و `.env.example` ليطابقا النظام الجديد.
- **يعتمد على:** 24، 35
- **الملفات:** `README.md`، `.env.example`
- **التفاصيل:** طريقة التشغيل، وتوليد `MASTER_KEY` وحفظ نسخة منه، و `ZATCA_TRANSPORT`، والاستيراد من JSON، وأوامر الـ migrations، والاختبارات، وتحديث قسم "حدود المشروع".
- **الأوامر:** —
- **معيار القبول:** مطوّر جديد يتبع README على نسخة نظيفة ويصل إلى شاشة البطاقات دون أسئلة.
- **رسالة الـ commit:** `docs: update README for modes and PostgreSQL`

---

## 4) التحقق النهائي

### 4.1 الأوامر

| الأمر | النتيجة المتوقعة |
| --- | --- |
| `npm run check:frozen` | لا فروق في `src/zatca/crypto` و `src/zatca/xml` |
| `npm run build` | ينجح |
| `npm test` | كل اختبارات الوحدات تنجح، بما فيها `test/signer.spec.ts` الأصلي دون تعديل |
| `npm run test:int` | كل اختبارات التكامل تنجح على `TEST_DATABASE_URL` |
| `cd frontend && npm run build` | ينجح |
| `npm run demo:offline` | يولّد 3 فواتير كما سابقاً |
| `docker compose down -v && docker compose up -d --build` | postgres healthy، ثم api تطبّق الـ migrations وتقلع، ثم web على 8090 |
| `docker compose exec postgres psql ... -c "select count(*) from environments where private_key_enc like '%PRIVATE KEY%'"` | 0 |
| `grep -rn "gw-fatoora" <سجلات الاختبار>` مع `ZATCA_TRANSPORT=fake` | لا طلبات للهيئة |

### 4.2 سيناريو يدوي كامل (الناقل الوهمي، `http://localhost:8090`)

1. **أول فتح:** قاعدة فارغة ← شاشة البطاقات. بوابة المطورين "مُعدّ"، والمحاكاة والإنتاج "غير مُعدّ"، والأعداد صفر.
2. **بوابة المطورين (أخضر):** اختيارها ← الإعدادات مكتملة فينتقل للتسجيل ← "تسجيل" دون إدخال OTP ← 6 فحوصات ناجحة ← اللوحة.
    - فاتورة مبسطة ← مقبولة، ICV=1.
    - قياسية ← مقبولة، و XML المعتمد ظاهر في التفاصيل.
    - رقم مكرر ← رسالة خطأ.
    - رقم `FAIL503-1` ← معلّقة. محاولة إعادة التسجيل ← مرفوضة بسبب المعلّق.
    - رقم `REJECT400-1` ← مرفوضة، وتظهر في الجدول بفلتر "مرفوضة".
    - إشعار دائن من صف فاتورة ← مقبول.
    - تجربة dryRun ← لا يتغير ICV.
3. **المحاكاة (برتقالي):** "تغيير الوضع" ← المحاكاة ← الإعدادات فارغة.
    - رقم ضريبي خاطئ ← خطأ تحت الحقل؛ تصحيحه ← التسجيل.
    - محاولة دون OTP ← مرفوضة؛ إدخال 6 أرقام ← مسجّل ← اللوحة.
    - الأعداد خاصة بالمحاكاة، و ICV يبدأ من 1.
    - العودة للبطاقات: كل بطاقة تعرض أعدادها الصحيحة.
4. **الإنتاج (أحمر):** اختيارها ← نافذة التأكيد.
    - `core` ← الزر معطّل؛ إلغاء ← لا يتغير شيء؛ `CORE` ← تفعيل.
    - الشريط الأحمر ظاهر في كل الشاشات.
    - الإعدادات ← التسجيل بـ OTP ← فاتورة واحدة ← مقبولة.
    - بعد التسجيل: تغيير الرقم الضريبي معطّل، والعنوان قابل للتعديل.
5. **المُجدوِل:** في بوابة المطورين، فاتورة `FAIL503-2`، ثم تعديل رقمها في القاعدة لرقم عادي وتقديم `next_retry_at` إلى الآن ← خلال 5 دقائق تصبح مقبولة دون تدخل.
6. **التزامن:** 20 طلب إصدار متوازٍ عبر `xargs -P 20 curl ...` ← ICV متتالية بلا تكرار.
7. **إعادة التشغيل:** `docker compose restart api` ← الوضع النشط والفواتير والسلسلة كما هي.
8. **الأمان:** إزالة `MASTER_KEY` ← api لا تقلع. استعلام القاعدة لا يُظهر مفتاحاً صريحاً.

---

## 5) أسئلة وقرارات تحتاج موافقتك قبل البدء

1. **الناقل الوهمي:** أقترح `ZATCA_TRANSPORT=fake` افتراضياً في التطوير و docker-compose، لأن قيد "لا طلبات للهيئة" يمنع غير ذلك من تجربة البطاقات الثلاث. هل يُسمح به في وضع الإنتاج أثناء التطوير؟ اقتراحي: نعم مع شارة "ناقل وهمي" ظاهرة في الشريط العلوي، ويرفض الإقلاع إذا كان `NODE_ENV=production` مع `fake`.
2. **OTP بوابة المطورين "يُرسل تلقائياً":** هل يبدأ التسجيل وحده بمجرد الوصول للشاشة، أم بضغطة زر واحدة دون إظهار حقل OTP؟ اقتراحي: ضغطة زر.
3. **إعادة التسجيل (force):** الكود الحالي يصفّر السلسلة (ICV=0) عند إعادة التسجيل. هل نُبقي ذلك (بزيادة `chain_epoch`)، أم نكمل العداد دون تصفير؟ يحتاج تأكيداً من وثائق الهيئة. اقتراحي: التصفير مع `chain_epoch` لمطابقة السلوك الحالي.
4. **فواتير التجربة (dryRun):** هل تُحفظ في جدول `invoices` بحالة `DRY_RUN` (مستثناة من فريد الرقم ومخفية افتراضياً من الجدول)، أم لا تُحفظ إطلاقاً؟ اقتراحي: تُحفظ.
5. **قفل الإعدادات بعد التسجيل:** هل توافق على قفل حقول الـ CSR والرقم الضريبي واسم المنشأة بعد التسجيل، مع بقاء العنوان قابلاً للتعديل؟
6. **رد 401 من الهيئة:** اقتراحي اعتباره PENDING مع تنبيه "مشكلة مصادقة"، وليس REJECTED، لأن الفاتورة نفسها لم تُرفض. موافق؟
7. **تشغيل الـ migrations:** تلقائياً عند إقلاع api (`migrationsRun: true`)، أم أمراً يدوياً منفصلاً قبل النشر؟ اقتراحي: تلقائياً في docker-compose، ويدوياً في الإنتاج الحقيقي لاحقاً.
8. **`MASTER_KEY`:** أين سيُحفظ في الإنتاج (ملف `.env` على الخادم أم خزنة أسرار)؟ تدوير المفتاح خارج نطاق هذه الخطة. موافق؟
9. **الوضع النشط عام:** تغييره من أي متصفح يغيّره لكل المستخدمين، ولا توجد مصادقة على الـ API. هل هذا مقبول لهذه المرحلة؟
10. **أدوات الاختبار:** إضافة `@nestjs/testing` و `supertest` كاعتماديات تطوير، واختبارات تكامل على قاعدة `zatca_test` في نفس حاوية postgres (المنفذ 5433). موافق؟ ولا إطار اختبار للواجهة، والقبول فيها بالبناء والتجربة اليدوية.
11. **قائمة الحزم والإصدارات** في 2.4: موافق؟
12. **التجميد:** القيد يقول إن `crypto/*` و `xml/*` تم التحقق منها بأداة الهيئة، لكن المستودع لا يحتوي دليلاً على ذلك (لا مخرجات fatoora ولا ردود)، وتقرير المراجعة رصد نقاطاً فيها (SigningTime بـ `Z`، تقريب السعر، الوسم 9 للقياسية). هل نلتزم بالتجميد الكامل ونؤجل هذه النقاط لمهمة منفصلة؟
13. **متغيرات `ZATCA_ENV` و `SELLER_*` و `EGS_*`:** إلغاؤها نهائياً بعد الخطوة 30، والإبقاء عليها فقط كمدخل لسكربت الاستيراد. موافق؟
14. **مسار `GET /zatca/invoices/:id/xml`:** يتغير `:id` من رقم الفاتورة إلى معرّف الصف (UUID). لا يوجد مستخدم آخر للمسار غير الواجهة. موافق؟
