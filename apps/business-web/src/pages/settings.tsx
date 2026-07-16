import PageShell from '../components/ui/page-shell';
import { useUi } from '../context/ui.context';

function SettingsPage() {
  const { theme, setTheme } = useUi();

  return (
    <PageShell title="Settings">
      <label htmlFor="theme-select">Theme: </label>
      <select id="theme-select" value={theme} onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </PageShell>
  );
}

export default SettingsPage;
