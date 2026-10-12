// Same as `npm run phone`, but the app talks to the live API. The phone only needs to reach this
// computer for the app bundle, so the same Wi-Fi is enough (no tunnel).
process.env.RUNSTRIDE_PROD = "1";
require("./start-phone.js");
