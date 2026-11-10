import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/common/AppErrorBoundary.tsx';
import './index.css';

console.info('[APP] Application mounted');

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary boundaryName="root">
    <App />
  </AppErrorBoundary>
);
