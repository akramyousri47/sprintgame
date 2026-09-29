import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './style.css';

const host = document.getElementById('app');
if (!host) throw new Error('#app host element is missing from index.html');

createRoot(host).render(<App />);
