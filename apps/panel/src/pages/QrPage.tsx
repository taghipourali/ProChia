import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Field, useToast } from '@prochia/ui';
import { Page } from '../components/kit';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Spot {
  id: string;
  code: string;
  label: string;
  isActive: boolean;
  url: string;
  svg: string;
}

export function QrPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const spots = useQuery({ queryKey: ['spots'], queryFn: () => api<Spot[]>('/staff/spots') });
  const menuQr = useQuery({
    queryKey: ['menu-qr'],
    queryFn: () => api<{ url: string; svg: string }>('/staff/qr/menu'),
  });
  const [label, setLabel] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api('/staff/spots', { method: 'POST', body: { label, stationId: null, isActive: true } }),
    onSuccess: () => {
      setLabel('');
      void client.invalidateQueries({ queryKey: ['spots'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Page
      title="QR میزها و منو"
      subtitle="هر میز QR خودش را دارد؛ سفارش اسکن‌شده سر همان میز می‌آید. برای چاپ از دکمه چاپ استفاده کنید."
      actions={
        <Button icon="printer" onClick={() => window.print()}>
          چاپ
        </Button>
      }
    >
      {auth.can('settings.edit') && (
        <div
          className="row no-print"
          style={{ alignItems: 'flex-end', marginBottom: 'var(--space-4)' }}
        >
          <Field label="میز یا مکان جدید">
            <input
              className="pc-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="میز ۷، سالن کراس‌فیت…"
            />
          </Field>
          <Button disabled={!label} loading={add.isPending} onClick={() => add.mutate()}>
            افزودن
          </Button>
        </div>
      )}
      <div className="qr-sheet">
        {menuQr.data && (
          <div className="qr-card">
            <div dangerouslySetInnerHTML={{ __html: menuQr.data.svg }} />
            <b>منوی پروچیا</b>
            <span className="hint">اسکن کن، ارزش غذایی ببین، پیش‌سفارش بده</span>
          </div>
        )}
        {spots.data
          ?.filter((s) => s.isActive)
          .map((s) => (
            <div key={s.id} className="qr-card">
              <div dangerouslySetInnerHTML={{ __html: s.svg }} />
              <b>{s.label}</b>
              <span className="hint ltr">{s.url.replace(/^https?:\/\//, '')}</span>
            </div>
          ))}
      </div>
    </Page>
  );
}
