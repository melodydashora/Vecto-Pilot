export default function requireDatabaseTestOptIn() {
  if (process.env.VECTO_RUN_DATABASE_TESTS !== '1') {
    throw new Error('These legacy tests start the gateway (including migrations) or write to DATABASE_URL. Use an explicitly prepared disposable database and VECTO_RUN_DATABASE_TESTS=1.');
  }
}
