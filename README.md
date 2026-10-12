# مشروع تجريبي: الربط مع هيئة الزكاة (المرحلة الثانية) بـ NestJS

مشروع تعليمي مكتوب من الصفر بدون مكتبات ZATCA جاهزة، حتى تفهم كل خطوة.
يغطي الرحلة كاملة: توليد المفتاح و CSR، شهادة الامتثال، فحوصات الامتثال، شهادة الإنتاج،
ثم بناء الفاتورة (UBL 2.1) وتجزئتها وتوقيعها (XAdES) ورمز QR وإرسالها (اعتماد / إبلاغ) مع إدارة السلسلة.

## المتطلبات

- Node.js 18 أو أحدث
- OpenSSL مثبت في النظام (موجود افتراضياً في Linux و macOS، وفي Windows يأتي مع Git Bash)

## التشغيل

```bash
npm install
cp .env.example .env      # عدّل بيانات منشأتك
npm run demo:offline      # تجربة كاملة بدون إنترنت، النتائج في مجلد output
npm test                  # اختبارات التوقيع والتجزئة و QR
npm run start:dev         # تشغيل الخادم على http://localhost:3000
```

## التشغيل بـ Docker مع الواجهة (React)

```bash
cp .env.example .env      # مرة واحدة
docker compose up -d --build
```

- الواجهة: http://localhost:8090 (إصدار الفواتير، التسجيل لدى الهيئة، السجل)
- الـ API مباشرة: http://localhost:3010/zatca/status
- المفاتيح والشهادات والفواتير محفوظة في volume اسمه `zatca-demo_zatca-data`، فلا تضيع عند إعادة التشغيل.
- الإيقاف: `docker compose down` (أضف `-v` لحذف البيانات والبدء من الصفر).

للتطوير المحلي بدون Docker: شغّل الخادم بـ `PORT=3010 npm run start:dev`، ثم `cd frontend && npm install && npm run dev` وافتح http://localhost:5180.

## خريطة المشروع ← الخطوات الـ 11

| الخطوة | الملف |
|---|---|
| 1. مفتاح خاص + CSR | `src/zatca/crypto/csr.ts` |
| 2–5. OTP، شهادة الامتثال، الفحوصات، شهادة الإنتاج | `src/zatca/onboarding.service.ts` |
| 6. بناء UBL 2.1 XML | `src/zatca/xml/invoice-builder.ts` |
| 7. تجزئة الفاتورة | `computeInvoiceHash` في `src/zatca/crypto/signer.ts` |
| 8. التوقيع ECDSA و XAdES | `signHash` و `signInvoice` في `signer.ts` |
| 9. رمز QR (TLV) | `src/zatca/crypto/qr.ts` |
| 10. الإرسال للهيئة | `src/zatca/api/zatca-api.service.ts` |
| 11. السلسلة (ICV + PIH) | `src/zatca/invoice.service.ts` و `storage/egs-store.service.ts` |

## واجهات الـ API

### 1) حالة الوحدة
```bash
curl http://localhost:3000/zatca/status
```

### 2) تجربة فاتورة بدون إرسال (لا تحتاج تسجيل)
```bash
curl -X POST "http://localhost:3000/zatca/invoices?dryRun=true" \
  -H "Content-Type: application/json" \
  -d '{"id":"INV-1","category":"simplified","lines":[{"name":"قهوة","quantity":2,"unitPrice":15}]}'
```
يعيد التجزئة ورمز QR كصورة (`qrImage`) ومسار ملف XML الموقّع.

### 3) التسجيل لدى الهيئة
```bash
curl -X POST http://localhost:3000/zatca/onboard \
  -H "Content-Type: application/json" -d '{"otp":"123345"}'
```
في بوابة المطورين يعمل أي OTP. في المحاكاة والإنتاج استخرجه من بوابة فاتورة (صالح لمدة قصيرة).

### 4) فاتورة مبسطة (B2C) ← إبلاغ
```bash
curl -X POST http://localhost:3000/zatca/invoices -H "Content-Type: application/json" \
  -d '{"id":"INV-2","category":"simplified","lines":[{"name":"تمر","quantity":1,"unitPrice":42.5}]}'
```

### 5) فاتورة قياسية (B2B) ← اعتماد
```bash
curl -X POST http://localhost:3000/zatca/invoices -H "Content-Type: application/json" -d '{
  "id":"INV-3","category":"standard",
  "buyer":{"name":"مؤسسة العميل","vatNumber":"300000000000003",
    "address":{"street":"طريق الملك فهد","buildingNumber":"1234","district":"العليا","city":"الرياض","postalCode":"12211"}},
  "lines":[{"name":"خدمة استشارية","quantity":3,"unitPrice":500}]}'
```

### 6) إشعار دائن / مدين
أضف `"kind":"credit"` أو `"kind":"debit"` مع `"originalInvoiceId"` و `"reason"`.

### 7) إعادة إرسال المعلّق
```bash
curl -X POST http://localhost:3000/zatca/invoices/retry-pending
```

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

1. غيّر `ZATCA_ENV` إلى `simulation` واستخرج OTP من بوابة فاتورة (المحاكاة)، وجرّب حتى تنجح كل الفحوصات.
2. ثم `core` للإنتاج بـ OTP من بوابة فاتورة الحقيقية.
3. كل جهاز/فرع (EGS) يحتاج تسجيلاً مستقلاً بمفتاح وشهادة وسلسلة خاصة به.

## حدود هذا المشروع (ماذا ينقصه للإنتاج)

- يدعم نسبة الضريبة الأساسية 15% (الفئة S) فقط. الصفرية والمعفاة تحتاج رموز أسباب الإعفاء.
- لا يدعم الخصومات على مستوى الفاتورة أو البند، ولا الدفعات المقدمة.
- التخزين في ملف JSON والمفتاح الخاص غير مشفّر. في الإنتاج: قاعدة بيانات بمعاملات + خزنة أسرار.
- السلسلة تتقدم لكل وثيقة تُصدر من الوحدة حتى لو رُفضت، وتُصحح المرفوضة بإصدار وثيقة جديدة. راجع هذه السياسة مع الوثائق الرسمية.
- لا يجدد شهادة الإنتاج تلقائياً (الدالة `renewProductionCsid` جاهزة في خدمة الـ API).
- لا يولّد PDF/A-3 للعميل.
