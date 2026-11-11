import { Tabs, TabSlot } from 'expo-router/ui';

// Web: render only the slot — no floating nav bar, no "Expo Starter" header.
// This prevents the overlapping top bar from blocking the Accessibility gear
// button and the STAND-ALONE / CLOUD SYNC mode toggles.
export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
    </Tabs>
  );
}
