import { Tabs, usePathname } from 'expo-router';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { getUiCopy } from '@/constants/ui-copy';
import { useAppLanguage } from '@/contexts/language-context';

export default function AppTabs() {
  const pathname = usePathname();
  const { languageLabel } = useAppLanguage();
  const copy = getUiCopy(languageLabel);
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.background,
          display: pathname === '/alert' ? 'none' : 'flex',
        },
        headerShown: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: copy.homeTab,
          // If you have tab icons setup, you can uncomment these lines:
          // tabBarIcon: ({ color }) => (
          //   <Image source={require('@/assets/images/tabIcons/home.png')} style={{ tintColor: color, width: 24, height: 24 }} />
          // )
        }}
      />

      <Tabs.Screen
        name="explore"
        options={{
          title: copy.exploreTab,
          // tabBarIcon: ({ color }) => (
          //   <Image source={require('@/assets/images/tabIcons/explore.png')} style={{ tintColor: color, width: 24, height: 24 }} />
          // )
        }}
      />

      <Tabs.Screen
        name="alert"
        options={{
          href: null, // This hides the tab completely from the navigation bar
        }}
      />
    </Tabs>
  );
}