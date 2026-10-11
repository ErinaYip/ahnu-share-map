import { config } from "./config.js";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";
import { seedDemoPlaces } from "./seed.js";

const db = openDatabase(config);
seedDemoPlaces(db, config);
const app = createApp({ db, config });

app.listen(config.port, config.host, () => {
  console.log(`[ahnu-share-map] http://${config.host}:${config.port}`);
  console.log(`[ahnu-share-map] database: ${config.databasePath}`);
});
