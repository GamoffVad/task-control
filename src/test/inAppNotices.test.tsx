import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { InAppNotices } from '../components/Notices';
import { useNotices } from '../lib/useNotices';

const fixtures = vi.hoisted(() => ({ fetch: vi.fn(), reload: vi.fn(), since: vi.fn(), write: vi.fn() }));
vi.mock('../lib/store', () => ({ useStore: () => ({ state: { user: { employeeId: 1 } }, fetchNotices: fixtures.fetch, reload: fixtures.reload }) }));
vi.mock('../lib/notices', () => ({
  noticesSupported: () => false, noticePermission: () => 'denied', readNoticePref: () => null,
  readSince: fixtures.since, writeSince: fixtures.write, writeNoticePref: vi.fn(), showNotice: vi.fn(), backgroundTimer: () => () => {},
}));
const View = () => { const push = useNotices(); return <InAppNotices push={push} />; };
describe('уведомления при HTTP', () => {
  beforeEach(() => {
    vi.stubGlobal('isSecureContext', false);
    fixtures.fetch.mockResolvedValue({ now: '2026-11-12T12:00:00Z', notices: [{ id: '1', at: '2026-11-12T11:59:00Z', title: 'Новая задача', body: 'Проверить документ', url: '/control' }] });
    fixtures.since.mockReturnValue('2026-11-12T11:00:00Z');
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it('показывает полученные события внутри открытой страницы без разрешения браузера', async () => {
    render(<MemoryRouter><View /></MemoryRouter>);
    expect(await screen.findByText('Новая задача')).toBeInTheDocument();
    expect(screen.getByText('Проверить документ')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть' })).toHaveAttribute('href', '/control');
    await waitFor(() => expect(fixtures.write).toHaveBeenCalled());
  });
});
