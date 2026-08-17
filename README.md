# Flashcards v1.4.2

## الملفات
- `index.html` الواجهة.
- `style.css` الشكل.
- `script.js` كل منطق التطبيق.
- `manifest.json` تثبيت التطبيق كـ PWA.
- `sw.js` تشغيل Offline على GitHub Pages.
- `icons/` أيقونات محلية بدون روابط Placeholder خارجية.

## التشغيل على GitHub Pages
ارفع الملفات كما هي إلى نفس مجلد الموقع، وتأكد أن `index.html` في جذر GitHub Pages.

لا توجد حاجة إلى Firebase لتشغيل الكلمات أو الحفظ أو الاختبارات. البيانات الأساسية محفوظة في `localStorage` على جهاز المستخدم.

## ملاحظة الصوت
اختبار الصوت يستخدم Web Speech API، لذلك دعمه يعتمد على المتصفح والميكروفون. Chrome وEdge عادةً أفضل من غيرهما لهذه الميزة.
