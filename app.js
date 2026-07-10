const { server } = require("./server");

const PORT = process.env.PORT || 3000;
const HOST = "127.0.0.1";

server.listen(PORT, HOST, () => {
  console.log(`SIREWA berjalan di http://${HOST}:${PORT}`);
});
