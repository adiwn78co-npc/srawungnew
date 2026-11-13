import { useState, useEffect, useCallback } from 'react';
import { getAuthToken } from './api.js';

export interface OrganizationSettings {
  organizationName: string;
  sidebarBrandName: string;
  sidebarSubtitle: string;
  updatedAt?: string;
  updatedByName?: string;
}

const EVENT_NAME = 'wijna-org-settings-updated';

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  organizationName: 'Yayasan Inti Muda Indonesia (WIJNA)',
  sidebarBrandName: 'Yayasan Inti Muda Indonesia (WIJNA)',
  sidebarSubtitle: 'HR & Program System',
};

let organizationSettingsMemoryCache: OrganizationSettings = {
  ...DEFAULT_ORGANIZATION_SETTINGS,
};

export function getOrganizationSettings(): OrganizationSettings {
  return { ...organizationSettingsMemoryCache };
}

export function setLocalOrganizationSettings(
  next: Partial<OrganizationSettings>
): OrganizationSettings {
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
  organizationSettingsMemoryCache = merged;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: merged }));
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
    // fallback to current memory settings if network fails transiently
  }
  return getOrganizationSettings();
}

export async function saveOrganizationSettingsToServer(
  patch: Partial<OrganizationSettings>,
  actorName?: string
): Promise<OrganizationSettings> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Sesi otentikasi tidak ditemukan. Silakan login kembali.');
  }

  const current = getOrganizationSettings();
  const payload: OrganizationSettings = {
    ...current,
    ...patch,
    organizationName:
      patch.organizationName !== undefined && patch.organizationName.trim()
        ? patch.organizationName.trim()
        : current.organizationName,
    sidebarBrandName:
      patch.sidebarBrandName !== undefined && patch.sidebarBrandName.trim()
        ? patch.sidebarBrandName.trim()
        : patch.organizationName !== undefined && patch.organizationName.trim()
        ? patch.organizationName.trim()
        : current.sidebarBrandName,
    sidebarSubtitle:
      patch.sidebarSubtitle !== undefined && patch.sidebarSubtitle.trim()
        ? patch.sidebarSubtitle.trim()
        : current.sidebarSubtitle,
    updatedAt: new Date().toISOString(),
    updatedByName: actorName,
  };

  const res = await fetch('/api/organization-settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let errMsg = `Gagal menyimpan pengaturan organisasi ke database (HTTP ${res.status}).`;
    try {
      const errBody = await res.json();
      if (errBody && typeof errBody.error === 'string' && errBody.error.trim()) {
        errMsg = errBody.error.trim();
      }
    } catch {
      // ignore non-json error body
    }
    throw new Error(errMsg);
  }

  const saved = await res.json();
  return setLocalOrganizationSettings(saved);
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
