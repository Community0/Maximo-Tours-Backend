const app = require('./src/app');
const config = require('./src/config');
const {initDB,getPool} = require('./src/db');
const {startNotifications} = require('./src/services/notifications');
let server, stopNotifications=()=>{};
async function start(){
 await initDB();
 server=app.listen(config.port,'0.0.0.0',()=>console.log('Maximo Tours API listening'));
 stopNotifications=startNotifications();
}
start().catch(()=>{console.error('Startup failed: check database and environment configuration');process.exit(1)});
let closing=false;
async function shutdown(){
 if(closing)return;closing=true;stopNotifications();
 const timer=setTimeout(()=>process.exit(1),20000);timer.unref();
 if(server)await new Promise(resolve=>server.close(resolve));
 await getPool()?.end();process.exit(0);
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
