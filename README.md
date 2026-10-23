# Davomat v5 — ko‘p tashkilotli, obunali versiya

Bitta dastur — ko‘p tashkilot. Har bir tashkilotning o‘z logosi, nomi, rangi, administratori va xodimlari bor. Ular bir-birining ma’lumotini **ko‘ra olmaydi**. Siz (dastur egasi) **super-admin** sifatida tashkilot qo‘shasiz, tarif belgilaysiz va to‘lov qabul qilib obunani uzaytirasiz. Obuna tugasa, tashkilot avtomatik to‘xtaydi.

## Paket tarkibi

| Papka | Nima |
|---|---|
| `supabase/schema.sql` | Butun server mantig‘i (baza + API). Supabase’ga bir marta joylanadi |
| `web/` | Dasturning o‘zi (telefon, planshet, kompyuter uchun) |
| `web/config.js` | **Siz o‘zgartiradigan yagona fayl** — Supabase manzili va kaliti |
| `web/privacy.html` | Maxfiylik siyosati (Play Market talab qiladi) — aloqa ma’lumotlaringizni yozing |
| `desktop/` | Windows uchun `.exe` ilova |
| `.github/workflows/` | GitHub’da saytni joylash va `.exe` yig‘ishni avtomatlashtiradi |

## Rollar

- **Super-admin (siz):** tashkilotlar, tariflar, to‘lovlar, obuna muddati, tashkilot adminlarining parolini tiklash.
- **Tashkilot administratori:**
  - kunlik panel;
  - davomatni tasdiqlash (bittalab yoki hammasini birdan);
  - xodimlar: qo‘shish, Excel’dan yuklash, telefonini almashtirish, o‘chirish;
  - oylik hisobot va Excel’ga yuklab olish;
  - logo, rang va ish joyi hududi;
  - obuna sahifasi.
- **Xodim:** bitta tugma bilan GPS davomat yuboradi, o‘z tarixini ko‘radi va parolini o‘zgartiradi.

---

## 1-QADAM. Supabase (server) — 10 daqiqa

1. https://supabase.com saytida ro‘yxatdan o‘ting (GitHub akkaunti bilan kirish mumkin).
2. **New project** tugmasini bosing:
   - **Name:** `davomat`
   - **Database password:** kuchli parol yozing va saqlab qo‘ying.
   - **Region:** **Central EU (Frankfurt)**. Bu O‘zbekistonga eng yaqin hudud.
   - **Create** ni bosing va 1–2 daqiqa kuting.
3. Chap menyuda **SQL Editor** → **New query** ni oching. `supabase/schema.sql` faylini **to‘liq** nusxalab joylang va **Run** ni bosing. Pastda “Success” chiqishi kerak.
4. Yangi so‘rov oching va o‘zingiz uchun super-admin yarating (login va parolni o‘zingiz tanlang):
   ```sql
   select dv.set_superadmin('superadmin', 'KuchliParol123');
   ```
   Parol esdan chiqsa, shu buyruqni yangi parol bilan qayta ishga tushirsangiz bo‘ldi.
5. **Project Settings → API Keys** (yoki yuqoridagi **Connect** tugmasi) bo‘limidan ikkita narsani nusxalang:
   - **Project URL**, masalan `https://abcdxyz.supabase.co`;
   - **anon public** kaliti (`eyJ...` bilan boshlanadi) yoki **publishable** kaliti (`sb_publishable_...`).

   ⚠️ `service_role` yoki `secret` kalitini hech qachon dasturga yozmang.
6. `web/config.js` ni oching va shu ikki qiymatni qo‘ying:
   ```js
   SUPABASE_URL: "https://abcdxyz.supabase.co",
   SUPABASE_KEY: "eyJhbGciOi....",
   ```

> **Xavfsizlik:** brauzer bazadagi jadvallarga to‘g‘ridan-to‘g‘ri kira olmaydi. Faqat `api` funksiyasini chaqiradi, u esa har bir so‘rovda sessiyani, rolni, qurilmani, tashkilotni va obunani tekshiradi. Parollar bcrypt bilan shifrlanadi. Login 15 daqiqada 8 marta noto‘g‘ri kiritilsa bloklanadi.

## 2-QADAM. Saytni joylash (GitHub Pages) — 10 daqiqa

Play Market ilovasi to‘g‘ri ishlashi uchun sayt **domen ildizida** turishi kerak. Shuning uchun quyidagi ikki yo‘ldan birini tanlang:

- **A) Bepul:** repository nomini aynan `GITHUB-LOGININGIZ.github.io` qilib qo‘ying. Sayt `https://GITHUB-LOGININGIZ.github.io/` manzilida ochiladi.
- **B) O‘z domeningiz (tavsiya etiladi):** masalan, `davomat.uz`. Domenni sotib olib, GitHub Pages’ga ulaysiz (Settings → Pages → Custom domain).

Qadamlar:
1. GitHub’da yangi repository yarating (A yoki B bo‘yicha nom bering).
2. Shu paketdagi **barcha** papka va fayllarni yuklang (`web`, `supabase`, `desktop`, `.github`, `README.md`).
   - `.github` yashirin papka. Agar brauzer orqali yuklashda u tushib qolsa, GitHub’da **Add file → Create new file** ni bosing va nomiga `.github/workflows/pages.yml` deb yozib, ichiga fayl matnini joylang.
3. **Settings → Pages → Source: “GitHub Actions”** ni tanlang.
4. **Actions** bo‘limida “Saytni joylash” jarayoni yashil belgi bilan tugashini kuting (1–2 daqiqa).
5. Saytni oching, pastdagi kichik **“Xizmat ko‘rsatuvchi”** havolasini bosing va super-admin login hamda parolingiz bilan kiring.
6. **Sozlamalar** bo‘limida:
   - to‘lov rekvizitlarini (karta yoki hisob raqam, telefon) yozing;
   - tariflarni (nom, xodimlar soni, narx) va sinov muddatini belgilang;
   - **Saqlash** ni bosing.

> Keyinchalik `web/` dagi biror faylni o‘zgartirsangiz, sayt avtomatik yangilanadi. Telefonlarda ilovani yopib, qayta ochish kifoya.

## 3-QADAM. Tashkilot qo‘shish va sotish

1. **Tashkilotlar → + Yangi tashkilot**:
   - nom, kod (masalan `samqurilish`), tarif va telefon raqamini kiriting;
   - administrator login va parolini kiriting;
   - **Saqlash** ni bosing.
2. Ekranda chiqqan **kirish havolasi, login va parolni** tashkilot rahbariga yuboring (📋 Nusxalash tugmasi bor).
3. Tashkilot admini kiradi, logosi va rangini qo‘yadi, xodimlarini qo‘shadi (bittalab yoki Excel’dan). Keyin xodimlarga `...?org=samqurilish` havolasini yuboradi. Xodimlar shu havolani ochganda kirish oynasida tashkilotning logosi va nomi chiqadi.
4. **Sinov muddati** (standart 14 kun) tugagach, tizim admin va xodimlarni to‘xtatadi. Admin faqat “Obuna” sahifasini ko‘radi, u yerda sizning rekvizitlaringiz turadi.
5. Tashkilot to‘lov qilgach: **Tashkilotlar** → tashkilotni bosing → **To‘lov qo‘shish** (necha oy, summa, usul) → **+ Qo‘shish**. Obuna darhol uzayadi va tashkilot ishlashda davom etadi. Muddat tugashidan oldin to‘lansa, yangi davr eski muddat tugagan kundan boshlab qo‘shiladi.
6. Asosiy panelda quyidagilarni ko‘rasiz:
   - oylik daromad;
   - shu oydagi tushum;
   - 7 kunda obunasi tugaydigan va muddati o‘tgan tashkilotlar.

**Tarif limiti:** faol xodimlar soni tarif limitiga yetganda yangi xodim qo‘shib bo‘lmaydi va adminga “tarifni oshiring” xabari chiqadi.

> **Avtomatik to‘lov (Payme / Click / Uzum):** buning uchun ular bilan merchant shartnomasi (YaTT yoki MChJ nomiga) tuzilishi kerak. Shartnoma tuzilgach, ularning API’sini ulash keyingi bosqich bo‘ladi. Hozircha to‘lov qo‘lda kiritiladi: bitta tugma bilan.

## 4-QADAM. Android — APK va Play Market

1. https://www.pwabuilder.com saytini oching, saytingiz manzilini kiriting va **Start** ni bosing.
2. **Package For Stores → Android → Generate Package** ni bosing:
   - **Package ID:** `uz.davomat.app`. Boshqa nom tanlasangiz, `web/.well-known/assetlinks.json` dagi `package_name` ni ham o‘zgartiring.
   - **App name:** `Davomat`.
   - **Signing key:** “Create new”.
3. Yuklab olingan zip ichida quyidagilar bo‘ladi:
   - `*.apk`: telefonga **to‘g‘ridan-to‘g‘ri o‘rnatish** uchun. Uni Telegram orqali yuborsangiz bo‘ladi.
   - `*.aab`: **Play Market** uchun.
   - `signing.keystore` va `signing-key-info.txt`: ⚠️ **ularni xavfsiz joyda saqlang**. Yo‘qolsa, ilovani hech qachon yangilay olmaysiz.
   - `assetlinks.json`: uning ichidagi qiymatni `web/.well-known/assetlinks.json` ga joylang va GitHub’ga yuklang. Bu ilova tepasidagi manzil satrini yo‘qotadi.
4. **Play Market’ga joylash:** https://play.google.com/console:
   - dasturchi akkaunti bir martalik **25 $** turadi;
   - **Create app** → `.aab` ni yuklang;
   - **Privacy policy:** `https://SAYTINGIZ/privacy.html`. Avval undagi aloqa ma’lumotlarini to‘ldiring;
   - **Data safety:** “Location (approximate and precise)”, “Name”, “Device ID” ni belgilang. Ular faqat ilova funksiyasi uchun ishlatiladi, uchinchi shaxslarga berilmaydi, ma’lumotlar shifrlanadi;
   - **Shaxsiy (individual) akkauntlar uchun Google talabi:** ilovani avval **yopiq testda kamida 12 kishi 14 kun** sinashi kerak, keyin ommaga chiqariladi. Kompaniya (tashkilot) akkauntida bu talab yo‘q, lekin D-U-N-S raqami so‘raladi.

## 5-QADAM. iPhone

- **Hoziroq, bepul:** iPhone’da Safari orqali saytni oching → **Ulashish (⬆️) → “На экран «Домой»” / “Add to Home Screen”**. Dastur ilova kabi bosh ekranda turadi va GPS ishlaydi. Kirish oynasidagi “Ilovani o‘rnatish” tugmasi shu yo‘riqnomani ko‘rsatadi.
- **App Store:**
  - Apple Developer akkaunti kerak, u **yiliga 99 $** turadi;
  - **Mac kompyuter va Xcode** kerak;
  - PWABuilder → **iOS** paketini yuklab olasiz, Xcode’da ochib, App Store’ga yuborasiz.

  Ogohlantirish: Apple “faqat veb-sahifani o‘rab qo‘yilgan” ilovalarni ba’zan rad etadi (4.2-qoida). Shuning uchun boshida iPhone foydalanuvchilariga bosh ekranga qo‘shish usulini taklif qiling.

## 6-QADAM. Windows (.exe)

1. `desktop/package.json` dagi `"appUrl"` qiymatini saytingiz manziliga almashtiring, masalan `"https://GITHUB-LOGININGIZ.github.io/"`, va GitHub’ga yuklang.
2. **Actions → “Windows EXE yig‘ish” → Run workflow** ni bosing. 5–8 daqiqa kuting.
3. Tugagan jarayon sahifasining pastidagi **Artifacts → Davomat-Windows** ni yuklab oling. Ichida ikkita fayl bor:
   - `Davomat-Setup-5.0.0.exe`: o‘rnatuvchi;
   - `Davomat-Portable-5.0.0.exe`: o‘rnatmasdan ishlaydigan versiya.

Eslatmalar:
- Ilova raqamli imzosiz bo‘lgani uchun Windows birinchi marta **“Windows protected your PC”** degan ogohlantirish chiqaradi. **More info → Run anyway** ni bosish kifoya. Ogohlantirishni butunlay yo‘qotish uchun pullik kod-imzo sertifikati kerak.
- Kompyuter ilovasi administratorlar uchun mo‘ljallangan. Xodimlar davomatni telefondan yuboradi, chunki kompyuterda GPS bo‘lmaydi.
- Muqobil yo‘l: Chrome yoki Edge’da saytni ochib, manzil satridagi **“O‘rnatish”** belgisini bosish. Natija xuddi `.exe` kabi alohida oynali ilova bo‘ladi.

## Eski versiyadan (Google Sheet) o‘tish

- Eski Google Sheet joyida qoladi va arxiv bo‘lib xizmat qiladi.
- Yangi tizimda tashkilotingizni yarating. Xodimlarni Excel’dan yuklang: **Xodimlar → Excel’dan yuklash**, “Namuna fayl” tugmasi bilan namunani olasiz. Eski parollar ko‘chmaydi, shuning uchun yangi boshlang‘ich parollar bering. Xodimlar keyin parolni o‘zlari o‘zgartiradi.
- Har bir xodim birinchi kirgan telefoni avtomatik biriktiriladi.

## Nimalar o‘zgardi va tuzatildi (v4 → v5)

- **Tezlik:** har bir so‘rov 1–3 soniya o‘rniga taxminan 0,1–0,3 soniyada bajariladi. Sahifalar telefondagi keshdan bir zumda ochiladi va fonda yangilanadi. 4,5 million yozuv bilan sinab ko‘rildi, 300 xodimli tashkilot paneli 0,03 soniyada yuklandi.
- **Hajm:** bir vaqtda 30 ta so‘rov chegarasi yo‘qoldi. Minglab xodim bemalol ishlay oladi.
- **Qurilma himoyasi yumshoq, lekin ishonchli bo‘ldi:** til, ekran masshtabi yoki brauzer yangilansa, xodim endi bloklanib qolmaydi. Boshqa telefondan esa baribir kira olmaydi.
- **Parol URL’da ochiq yurmaydi:** endi POST va HTTPS orqali yuboriladi va serverda bcrypt bilan saqlanadi.
- **Ikki xodim bir paytda yuborganda yozuvlar aralashib ketish xatosi** yo‘qoldi.
- **Oy boshidagi soat 00:00–05:00 dagi noto‘g‘ri oy xatosi** tuzatildi. Vaqt tashkilot vaqt mintaqasida hisoblanadi.
- **Yangi imkoniyatlar:**
  - ish joyi hududi (radius): uzoqdan yuborilganlar “Hududdan tashqarida” deb belgilanadi;
  - GPS aniqligi past bo‘lsa ogohlantirish;
  - kunlik yuborish limiti;
  - bir xodim 2 daqiqa ichida qayta yubora olmaydi;
  - hammasini birdan tasdiqlash;
  - yubormaganlar ro‘yxatini nusxalash (Telegram uchun);
  - Excel eksport va import;
  - har xodim kelgan kunlar soni.

## Xarajatlar

| Nima | Narx |
|---|---|
| Supabase | **Bepul** tarif: 500 MB baza, bu taxminan bir necha ming xodimga bir necha yil yetadi. **Pro** tarif oyiga 25 $: kunlik zaxira nusxa beradi va loyiha “uxlab qolmaydi”. Pullik mijozlar paydo bo‘lgach, Pro’ga o‘ting |
| GitHub Pages | Bepul |
| Domen (ixtiyoriy) | `.uz` domen yiliga taxminan 50–150 ming so‘m |
| Google Play | Bir marta 25 $ |
| Apple App Store | Yiliga 99 $ (va Mac) |

> Supabase bepul tarifida loyiha **7 kun umuman ishlatilmasa** to‘xtatiladi, uni panel orqali qayta yoqiladi. Kundalik foydalanishda bu holat yuz bermaydi.

## Muhim xavfsizlik eslatmalari

- `web/config.js` dagi **anon / publishable** kaliti ochiq turishi normal holat, u shunday ishlashga mo‘ljallangan.
- **service_role / secret** kaliti, Supabase baza paroli va Android `signing.keystore` faylini hech kimga bermang.
- Bepul tarifda Supabase zaxira nusxa (backup) bermaydi. Har oy **Davomatlar → Excel (CSV)** orqali hisobotlarni yuklab olib qo‘ying yoki Pro tarifga o‘ting.
