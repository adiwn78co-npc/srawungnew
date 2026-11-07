import { useState, useEffect, useCallback } from 'react';
import { getAuthToken } from './api.js';

export interface OrganizationSettings {
  organizationName: string;
  sidebarBrandName: string;
  sidebarSubtitle: string;
  updatedAt?: string;
  updatedByName?: string;
}

const STORAGE_KEY = 'wijna_organization_settings_v1';
const EVENT_NAME = 'wijna-org-settings-updated';

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  organizationName: 'Yayasan Inti Muda Indonesia (WIJNA)',
  sidebarBrandName: 'Yayasan Inti Muda Indonesia (WIJNA)',
  sidebarSubtitle: 'HR & Program System',
};

export function getOrganizationSettings(): OrganizationSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_ORGANIZATION_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ORGANIZATION_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      organizationName:
        typeof parsed.organizationName === 'string' && parsed.organizationName.trim()
          ? parsed.organizationName.trim()
          : DEFAULT_ORGANIZATION_SETTINGS.organizationName,
      sidebarBrandName:
        typeof parsed.sidebarBrandName === 'string' && parsed.sidebarBrandName.trim()
          ? parsed.sidebarBrandName.trim()
          : typeof parsed.organizationName === 'string' && parsed.organizationName.trim()
          ? parsed.organizationName.trim()
          : DEFAULT_ORGANIZATION_SETTINGS.sidebarBrandName,
      sidebarSubtitle:
        typeof parsed.sidebarSubtitle === 'string' && parsed.sidebarSubtitle.trim()
          ? parsed.sidebarSubtitle.trim()
          : DEFAULT_ORGANIZATION_SETTINGS.sidebarSubtitle,
      updatedAt: parsed.updatedAt,
      updatedByName: parsed.updatedByName,
    };
  } catch {
    return DEFAULT_ORGANIZATION_SETTINGS;
  }
}

export function setLocalOrganizationSettings(next: Partial<OrganizationSettings>): OrganizationSettings {
  const current = getOrganizationSettings();
  const merged: OrganizationSettings = {
    ...current,
    ...next,
    organizationName:
      next.organizationName !== undefined && next.organizationName.trim()
        ? next.organizationName.trim()
        : current.organizationName,
    sidebarBrandName:
      next.sidebarBrandName !== undefined && next.sidebarBrandName.trim()
        ? next.sidebarBrandName.trim()
        : next.organizationName !== undefined && next.organizationName.trim()
        ? next.organizationName.trim()
        : current.sidebarBrandName,
    sidebarSubtitle:
      next.sidebarSubtitle !== undefined && next.sidebarSubtitle.trim()
        ? next.sidebarSubtitle.trim()
        : current.sidebarSubtitle,
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: merged }));
    } catch {
      // ignore storage errors
    }
  }
  return merged;
}

export async function hydrateOrganizationSettingsFromServer(): Promise<OrganizationSettings> {
  const token = getAuthToken();
  if (!token) {
    return getOrganizationSettings();
  }
  try {
    const res = await fetch('/api/organization-settings', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object' && data.organizationName) {
        return setLocalOrganizationSettings(data);
      }
    }
  } catch {
    // fallback to local settings
  }
  return getOrganizationSettings();
}

export async function saveOrganizationSettingsToServer(
  patch: Partial<OrganizationSettings>,
  actorName?: string
): Promise<OrganizationSettings> {
  const optimistic = setLocalOrganizationSettings({
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedByName: actorName,
  });
  const token = getAuthToken();
  if (!token) {
    return optimistic;
  }
  try {
    const res = await fetch('/api/organization-settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...optimistic,
        updatedByName: actorName,
      }),
    });
    if (res.ok) {
      const saved = await res.json();
      return setLocalOrganizationSettings(saved);
    }
  } catch {
    // keep optimistic local state
  }
  return optimistic;
}

export function useOrganizationSettings() {
  const [settings, setSettings] = useState<OrganizationSettings>(() => getOrganizationSettings());

  useEffect(() => {
    const handleUpdate = () => {
      setSettings(getOrganizationSettings());
    };
    window.addEventListener(EVENT_NAME, handleUpdate);
    return () => {
      window.removeEventListener(EVENT_NAME, handleUpdate);
    };
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<OrganizationSettings>, actorName?: string) => {
      const updated = await saveOrganizationSettingsToServer(patch, actorName);
      setSettings(updated);
      return updated;
    },
    []
  );

  return {
    settings,
    organizationName: settings.organizationName,
    sidebarBrandName: settings.sidebarBrandName,
    sidebarSubtitle: settings.sidebarSubtitle,
    updateSettings,
  };
}
