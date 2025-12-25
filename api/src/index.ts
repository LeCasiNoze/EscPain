import { migrate } from "./migrate.js";
import { createApp } from "./app.js";

migrate();

const app = createApp();
const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`[api] http://localhost:${port}`);
});
