import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
console.log('Hooks:', Object.keys(reactHooks));
if (reactHooks.configs) console.log('Hooks Configs:', Object.keys(reactHooks.configs));
console.log('Refresh:', Object.keys(reactRefresh));
if (reactRefresh.configs) console.log('Refresh Configs:', Object.keys(reactRefresh.configs));
