import { BrowserRouter, Route, Routes } from 'react-router-dom';
import WorkspacePage from './pages/WorkspacePage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WorkspacePage />} />
      </Routes>
    </BrowserRouter>
  );
}
