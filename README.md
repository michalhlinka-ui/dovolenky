# Dovolenky – jednoduchá Netlify appka (bez backendu)

Toto je jednofájlová (statická) aplikácia, ktorú môžete nahrať na Netlify cez **Drag & Drop**.
- Mobilná: responzívne CSS, funguje ako PWA (pridať na plochu).
- Prihlásenie: jednoduché kódy (admin + osobné kódy). *Nie je to bezpečnostný systém*, len ochrana pred omylom.
- Admin: pridáva/uberá ľudí, nastavuje dovolenku (stará/nová), schvaľuje žiadosti.
- Zamestnanec: nahlási dni klikom do kalendára (žlté). Po schválení zelené.
- Odpočítavanie: najprv míňa **starú** dovolenku, potom **novú**.
- Export/Import: JSON súbor pre zálohu alebo prenos.

## Rýchly štart
1. Zazipujte obsah priečinka (alebo použite priložený `vacation-app.zip`).
2. Na Netlify vyberte **Add new site → Deploy manually** a súbor pustite do okna.
3. V appke sa prihláste ako **Admin** (`admin123`) – v Nastaveniach si kód zmeňte.
4. Pridajte ľudí (max ~30 podľa vašej požiadavky).
5. Rozdeľte im kódy a každý sa prihlási kódom „Zamestnanec“ – uvidí len svoje meno a dni.

## Poznámky a limity
- Údaje sa ukladajú **len do prehliadača** (localStorage). Na tímové používanie na viacerých zariadeniach doplňte backend (Netlify Functions + databáza).
- V administrácii je jednoduchý prompt na schvaľovanie – pre rýchle použitie. Dá sa neskôr nahradiť vysúvacím panelom.
- Kalendár prepínate šípkami alebo rozbaľovačmi mesiaca a roka.
