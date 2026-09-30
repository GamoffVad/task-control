import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { NAV } from './components/nav';
import { Shell } from './components/Shell';
import { TooltipLayer } from './kit';
import { AppearanceStyles } from './components/AppearanceStyles';
import { Favicon } from './components/Favicon';
import { DictionaryColors } from './components/DictionaryColors';
import { canOpenPath } from './lib/permissions';
import { useStore } from './lib/store';
import { StoreProvider } from './lib/StoreProvider';
import type { AppState } from './lib/types';
import { Absences } from './screens/Absences';
import { Admin } from './screens/Admin';
import { Calendar } from './screens/Calendar';
import { Chat } from './screens/Chat';
import { Control } from './screens/Control';
import { Employees } from './screens/Employees';
import { Info } from './screens/Info';
import { Kit } from './screens/Kit';
import { Kpi } from './screens/Kpi';
import { Login } from './screens/Login';
import { Planning } from './screens/Planning';
import { Reports } from './screens/Reports';

const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { state } = useStore();
  const location = useLocation();
  if (!state.user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
};

/** Раздел только для руководителя: исполнителя возвращает в календарь. */
const ManagerOnly = ({ children }: { children: ReactNode }) => {
  const { state } = useStore();
  const { pathname } = useLocation();
  if (!canOpenPath(state.user, pathname)) return <Navigate to="/calendar" replace />;
  return children;
};

const Title = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    const item = NAV.find((n) => pathname.startsWith(n.to));
    const page = pathname === '/login' ? 'Вход' : pathname.startsWith('/admin') ? 'Администрирование' : item?.label;
    document.title = page ? `${page} · Контроль задач` : 'Контроль задач';
  }, [pathname]);
  return null;
};

const NotFound = () => (
  <div className="not-found">
    <h1>Страница не найдена</h1>
    <p className="subtitle">
      Адрес устарел или набран с ошибкой. <Link to="/calendar">Перейти в календарь</Link>
    </p>
  </div>
);

export const AppRoutes = () => (
  <>
    <Title />
    <TooltipLayer />
    <AppearanceStyles />
    <Favicon />
    <DictionaryColors />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/calendar" replace />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="planning" element={<Planning />} />
        <Route path="control" element={<Control />} />
        <Route path="tetris" element={<Absences />} />
        {/* Прежний адрес раздела до переименования в «Тетрис». */}
        <Route path="absences" element={<Navigate to="/tetris" replace />} />
        <Route path="reports" element={<ManagerOnly><Reports /></ManagerOnly>} />
        <Route path="kpi" element={<ManagerOnly><Kpi /></ManagerOnly>} />
        <Route path="admin" element={<ManagerOnly><Admin /></ManagerOnly>} />
        <Route path="employees" element={<Employees />} />
        <Route path="employees/:id" element={<Employees />} />
        <Route path="chat" element={<Chat />} />
        <Route path="info" element={<Info />} />
        <Route path="kit" element={<Kit />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  </>
);

const App = ({ initial }: { initial?: AppState }) => (
  <StoreProvider initial={initial}>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppRoutes />
    </BrowserRouter>
  </StoreProvider>
);

export default App;
