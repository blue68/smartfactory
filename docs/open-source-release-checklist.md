# Open Source Release Checklist

## License And Usage

- [x] Added `LICENSE` with source-available non-commercial terms.
- [x] Added `NOTICE` with commercial-use restriction.
- [x] Updated root `package.json` and `package-lock.json` from `ISC` to `SEE LICENSE IN LICENSE`.
- [x] Added README section for non-commercial authorization.
- [x] Clarified that donations do not grant commercial authorization.

## Donation Assets

- [x] Added donation documentation in `SUPPORT.md`.
- [x] Reserved asset paths under `docs/assets/donation/`.
- [ ] Save the original WeChat Pay QR image as `docs/assets/donation/wechat-pay-reward.jpg`.
- [ ] Save the original Alipay QR image as `docs/assets/donation/alipay-reward.jpg`.

Use the original exported images. Do not redraw, regenerate, crop, or heavily
compress payment QR codes.

## Sensitive File Check

- [x] `.env` is ignored by `.gitignore`.
- [x] `services/mini/project.private.config.json` is ignored by `.gitignore`.
- [x] `services/mini/miniprogram/project.private.config.json` is ignored by `.gitignore`.
- [x] `git ls-files` shows no tracked `.env` or private mini-program config files.

Manual review is still recommended before making the repository public:

- rotate any secrets that may have been used locally;
- review docs for real customer data, names, phone numbers, addresses, and screenshots;
- decide whether demo passwords in README and SQL seed data should stay as public demo data;
- confirm all third-party dependency licenses are acceptable for the intended release model.
