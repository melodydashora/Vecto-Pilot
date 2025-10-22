import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function recallContext(scope, key = null) {
  if (key) {
    const { rows } = await pool.query(
      `SELECT * FROM assistant_memory WHERE scope = $1 AND key = $2 ORDER BY updated_at DESC LIMIT 1`,
      [scope, key]
    );
    return rows[0] || null;
  }
  const { rows } = await pool.query(
    `SELECT * FROM assistant_memory WHERE scope = $1 ORDER BY updated_at DESC`,
    [scope]
  );
  return rows;
}

(async () => {
  console.log('\n📚 Testing Assistant Memory Recall...\n');
  
  const arch = await recallContext('architecture');
  console.log(`✅ Architecture memories: ${arch.length}`);
  arch.forEach(m => console.log(`   - ${m.key}: ${JSON.stringify(m.content).substring(0, 80)}...`));
  
  const dbPhil = await recallContext('architecture', 'database_philosophy');
  console.log(`\n✅ DB Philosophy:`);
  console.log(`   Principle: ${dbPhil?.content?.principle}`);
  console.log(`   Rule: ${dbPhil?.content?.rule}`);
  console.log(`   Reasoning: ${dbPhil?.content?.reasoning}`);
  
  const deployment = await recallContext('deployment');
  console.log(`\n✅ Deployment memories: ${deployment.length}`);
  deployment.forEach(m => console.log(`   - ${m.key}`));
  
  await pool.end();
})();
