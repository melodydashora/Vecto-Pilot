import net from 'node:net';
const ports = (process.argv.slice(2).length ? process.argv.slice(2) : ['3101','43717','24700']).map(Number);
function check(port){return new Promise(r=>{
  const s = net.createServer()
    .once('error', e => r({port, free:false, error:e.code || String(e)}))
    .once('listening', () => s.close(()=>r({port, free:true})))
    .listen(port, '127.0.0.1');
});}
const results = await Promise.all(ports.map(check));
for (const r of results) console.log(`${String(r.port).padEnd(6)} : ${r.free ? 'free' : 'IN USE'}${r.error ? ' ('+r.error+')' : ''}`);