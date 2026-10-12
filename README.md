# مشروع تجريبي: الربط مع هيئة الزكاة (المرحلة الثانية) بـ NestJS

مشروع تعليمي مكتوب من الصفر بدون مكتبات ZATCA جاهزة، حتى تفهم كل خطوة.
يغطي الرحلة كاملة: توليد المفتاح و CSR، شهادة الامتثال، فحوصات الامتثال، شهادة الإنتاج،
ثم بناء الفاتورة (UBL 2.1) وتجزئتها وتوقيعها (XAdES) ورمز QR وإرسالها (اعتماد / إبلاغ) مع إدارة السلسلة.

البيانات في PostgreSQL، ولكل وضع تشغيل (بوابة المطورين، المحاكاة، الإنتاج) إعدادات منشأة وشهادة وسلسلة فواتير مستقلة.
المفتاح الخاص والأسرار مشفّرة بـ AES-256-GCM.

## المتطلبات

- Docker و Docker Compose (للتشغيل الكامل)
- Node.js 20 أو أحدث (للتطوير والاختبارات)
- OpenSSL في النظام (موجود افتراضياً في Linux و macOS، وفي Windows يأتي مع Git Bash)

## التشغيل السريع (Docker)

```bash
cp .env.example .env
echo "MASTER_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d --build
```

افتح http://localhost:8090 فتظهر شاشة **اختر وضع التشغيل**.

- الـ API مباشرة: http://localhost:3010/zatca/modes
- الـ migrations تُطبَّق تلقائياً عند إقلاع api. البيانات في volume اسمه `zatca-demo_pgdata`.
- الإيقاف: `docker compose down` (أضف `-v` لحذف البيانات والبدء من الصفر).

### مفتاح التشفير `MASTER_KEY`

- إلزامي: التطبيق لا يقلع بدونه، أو إذا لم يكن Base64 لـ 32 بايت بالضبط.
- يشفّر المفتاح الخاص و secret و binarySecurityToken لكل وضع في القاعدة.
- **احفظ نسخة منه خارج الخادم.** ضياعه يعني ضياع المفاتيح الخاصة، وإعادة التسجيل لكل الأوضاع.
- لا تغيّره بعد حفظ بيانات مشفّرة: القيم القديمة لن تُفك.

### الاتصال بالهيئة: `ZATCA_TRANSPORT`

| القيمة | السلوك |
|---|---|
| `fake` (الافتراضي) | لا اتصال بخوادم الهيئة. جهة إصدار محلية توقّع الـ CSR، وردود محلية للتسجيل والإرسال. للتطوير والاختبار فقط. |
| `live` | الاتصال الحقيقي بمنصة فاتورة حسب الوضع المختار. |

في الناقل الوهمي، رقم الفاتورة يحدد الرد للتجربة: `FAIL503` ← 503 (تبقى معلّقة)، `REJECT400` ← مرفوضة، `WARN202` ← مقبولة مع تحذيرات، `TIMEOUT` ← انقطاع اتصال.

## أوضاع التشغيل

| الوضع | اللون | الوصف |
|---|---|---|
| بوابة المطورين | أخضر | تجربة حرة. الإعدادات التجريبية معبّأة مسبقاً، و OTP `123345` يُرسل تلقائياً. |
| المحاكاة | برتقالي | بيانات المنشأة الحقيقية دون أثر رسمي. OTP من بوابة فاتورة (المحاكاة). |
| الإنتاج | أحمر | فواتير رسمية. يتطلب كتابة `CORE` للتفعيل، وشريط تحذير دائم. |

بعد اختيار الوضع تنتقل الواجهة تلقائياً: إعدادات المنشأة (إن لم تكتمل) ← التسجيل ← لوحة التحكم.
بعد التسجيل تُقفل حقول الشهادة (الاسم، الرقم الضريبي، بيانات EGS)، ويبقى العنوان قابلاً للتعديل.

## التطوير المحلي (بدون Docker للخادم)

```bash
npm install
cp .env.example .env
echo "MASTER_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d postgres          # القاعدة فقط، على localhost:5433
npm run migration:run                  # أو تُطبَّق تلقائياً عند الإقلاع
PORT=3010 npm run start:dev
cd frontend && npm install && npm run dev   # http://localhost:5180
```

### الـ migrations

```bash
npm run migration:show                 # المطبّق والمعلّق
npm run migration:run
npm run migration:revert               # التراجع عن آخر واحدة
npm run migration:generate -- src/database/migrations/<Name>   # بعد تعديل الكيانات
```

`synchronize` معطّل دائماً. لإيقاف التطبيق التلقائي عند الإقلاع: `DB_MIGRATIONS_RUN=false`.

### استيراد البيانات القديمة (ملفات JSON)

إن كانت لديك حالة من النسخة السابقة في `data/egs-<env>.json`:

```bash
npm run import:json -- --dry-run       # يعرض ما سيحدث دون كتابة
npm run import:json                    # أو: -- --dir <مجلد>
```

- يشفّر المفتاح والشهادات بـ `MASTER_KEY` الحالي، وينقل `icv` و `pih`، وكل فاتورة معلّقة تصبح `PENDING`.
- بيانات `SELLER_*` و `EGS_*` في `.env` تُطبَّق على الوضع المذكور في `ZATCA_ENV` فقط.
- يرفض الكتابة فوق وضع فيه بيانات إلا مع `--force`.
- الـ volume القديم في Docker (`zatca-demo_zatca-data`) لم يعد مستخدماً. انسخ محتواه لمجلد واستورده، ثم احذفه إن أردت.

## الاختبارات

```bash
npm test                               # اختبارات الوحدات (بدون قاعدة)
docker compose exec postgres createdb -U zatca zatca_test    # مرة واحدة
TEST_DATABASE_URL=postgres://zatca:<كلمة المرور>@localhost:5433/zatca_test npm run test:int
npm run check:frozen                   # ملفات crypto/ و xml/ لم تتغير
npm run demo:offline                   # 3 فواتير موقّعة في مجلد output
```

- اختبارات التكامل تحذف جداول قاعدة الاختبار وتعيد إنشاءها، لذلك ترفض أي قاعدة لا ينتهي اسمها بـ `_test`.
- كلها تستخدم الناقل الوهمي، ولا ترسل أي طلب للهيئة.

## خريطة المشروع ← الخطوات الـ 11

| الخطوة | الملف |
|---|---|
| 1. مفتاح خاص + CSR | `src/zatca/crypto/csr.ts` |
| 2–5. OTP، شهادة الامتثال، الفحوصات، شهادة الإنتاج | `src/zatca/onboarding.service.ts` |
| 6. بناء UBL 2.1 XML | `src/zatca/xml/invoice-builder.ts` |
| 7. تجزئة الفاتورة | `computeInvoiceHash` في `src/zatca/crypto/signer.ts` |
| 8. التوقيع ECDSA و XAdES | `signHash` و `signInvoice` في `signer.ts` |
| 9. رمز QR (TLV) | `src/zatca/crypto/qr.ts` |
| 10. الإرسال للهيئة | `src/zatca/api/zatca-api.service.ts` و `src/zatca/submission/` |
| 11. السلسلة (ICV + PIH) | `src/zatca/chain/chain.service.ts` (transaction مع `SELECT ... FOR UPDATE`) |

أخرى: إعدادات الأوضاع `src/zatca/environments/`، اختيار الوضع `src/zatca/modes/`، التشفير `src/security/`، الجداول `src/database/`.

## واجهات الـ API

المنافذ: `3010` عبر Docker، أو `PORT` محلياً. العمليات تعمل على **الوضع النشط**.

| الطريقة والمسار | الوظيفة |
|---|---|
| `GET /zatca/modes` | الأوضاع الثلاثة: حالتها وعدد فواتيرها |
| `GET` و `PUT /zatca/mode` | الوضع النشط. التحويل للإنتاج: `{"mode":"core","confirm":"CORE"}` |
| `GET` و `PUT /zatca/environments/:env/settings` | إعدادات المنشأة و EGS (تحقق صارم) |
| `GET /zatca/status` | حالة الوضع النشط وإحصاءات اللوحة |
| `POST /zatca/onboard` | التسجيل `{"otp":"123456","force":false}` (OTP اختياري في بوابة المطورين) |
| `POST /zatca/invoices` | إصدار فاتورة وإرسالها، و `?dryRun=true` للتجربة |
| `POST /zatca/invoices/retry-pending` | إعادة إرسال المعلّق الآن |
| `GET /zatca/invoices` | الجدول: `status` `category` `kind` `q` `from` `to` `includeDryRun` `page` `pageSize` |
| `GET /zatca/invoices/:id` | تفاصيل فاتورة وصورة QR ورد الهيئة |
| `GET /zatca/invoices/:id/xml` | الـ XML، و `?version=signed\|cleared` |

مثال سريع (بوابة المطورين مع الناقل الوهمي):

```bash
curl -X PUT localhost:3010/zatca/mode -H "Content-Type: application/json" -d '{"mode":"developer-portal"}'
curl -X POST localhost:3010/zatca/onboard -H "Content-Type: application/json" -d '{}'
curl -X POST localhost:3010/zatca/invoices -H "Content-Type: application/json" \
  -d '{"id":"INV-1","category":"simplified","lines":[{"name":"قهوة","quantity":2,"unitPrice":15}]}'
```

الفاتورة القياسية (B2B) تحتاج `buyer` بالاسم والعنوان. الإشعار الدائن أو المدين: `"kind":"credit"` أو `"debit"` مع `"originalInvoiceId"` و `"reason"`.

الفواتير التي لم تصل (انقطاع، 5xx، 401) تبقى `PENDING`، ويعيد المُجدوِل إرسالها كل 5 دقائق بتأخير تصاعدي (5 دقائق ثم 10 ثم 20… حتى 6 ساعات).
المرفوضة (400) تبقى في الجدول بحالة `REJECTED`.

## التحقق بأداة الهيئة الرسمية (SDK)

حمّل الـ SDK من بوابة المطورين، ثم:
```bash
fatoora -validate -invoice output/01-simplified-invoice.xml
```
ملاحظات من التجربة:
- الـ SDK يحتاج Java من 11 إلى 14. الإصدارات الأحدث لا تدعم منحنى secp256k1 فيفشل فحص التوقيع.
- أضف `-Dfile.encoding=UTF-8` لأمر java إذا كانت البيانات عربية، وإلا يفشل فحص QR.
- فحص التوقيع يقارن بالشهادة المضبوطة في `Data/Certificates/cert.pem`، فضع فيها شهادتك.
- فحص PIH يقارن بالملف `Data/PIH/pih.txt`، ولذلك يحفظ العرض التجريبي ملف `.pih.txt` بجانب كل فاتورة.

## الانتقال من التجربة للإنتاج

1. اضبط `ZATCA_TRANSPORT=live` في `.env`.
2. اختر **المحاكاة**، وأدخل بيانات منشأتك الحقيقية، وسجّل بـ OTP من بوابة فاتورة (المحاكاة). جرّب حتى تنجح كل الفحوصات والفواتير.
3. اختر **الإنتاج** (اكتب `CORE`)، وسجّل بـ OTP من بوابة فاتورة الرسمية.
4. كل جهاز/فرع (EGS) يحتاج تسجيلاً مستقلاً بمفتاح وشهادة وسلسلة خاصة به.

## حدود هذا المشروع (ماذا ينقصه للإنتاج)

- يدعم نسبة الضريبة الأساسية 15% (الفئة S) فقط. الصفرية والمعفاة تحتاج رموز أسباب الإعفاء.
- لا يدعم الخصومات على مستوى الفاتورة أو البند، ولا الدفعات المقدمة.
- لا توجد مصادقة على الـ API، والوضع النشط واحد لكل المستخدمين.
- وحدة إصدار (EGS) واحدة لكل وضع، وليس لكل فرع.
- `MASTER_KEY` في ملف `.env`. في الإنتاج الحقيقي: خزنة أسرار (Vault / KMS / HSM)، مع خطة لتدوير المفتاح.
- السلسلة تتقدم لكل وثيقة تُصدر من الوحدة حتى لو رُفضت، وتُصحح المرفوضة بإصدار وثيقة جديدة. راجع هذه السياسة مع الوثائق الرسمية.
- لا يجدد شهادة الإنتاج تلقائياً (الدالة `renewProductionCsid` جاهزة في خدمة الـ API، وتاريخ الانتهاء ظاهر في اللوحة).
- لا يولّد PDF/A-3 للعميل.
