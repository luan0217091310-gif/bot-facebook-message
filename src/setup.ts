import 'dotenv/config';
import {Graph} from './adapters/messenger/graph.js';
import {messengerConfig} from './adapters/messenger/config.js';
import {setup} from './adapters/messenger/profile.js';
await setup(new Graph(messengerConfig(process.env)));
console.log('Đã cài Messenger Profile cho Page.');
