import("@tetherto/wdk")
  .then(() => import("@tetherto/wdk-wallet-solana"))
  .then(() => {
    console.log("WDK setup OK");
  })
  .catch((error) => {
    console.error("WDK setup failed:", error.message);
    process.exit(1);
  });
