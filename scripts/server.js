import process from "node:process";
import app from "../app.js";

const port = Number(process.env.PORT || 3020);
const host = process.env.HOST || "127.0.0.1";

app.listen(port, host, () => {
  console.log(`API de Automatización Fruver disponible en http://${host}:${port}/api`);
});
