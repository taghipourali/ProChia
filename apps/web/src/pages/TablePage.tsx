import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Spinner, useToast } from '@prochia/ui';
import { api, errorMessage } from '../lib/api';
import { useCart } from '../lib/cart';

/** Landing page for table QR codes: remembers the table for this visit, then opens the menu. */
export function TablePage() {
  const { code = '' } = useParams();
  const cart = useCart();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    api<{ code: string; label: string }>(`/spots/${encodeURIComponent(code)}`)
      .then((spot) => {
        if (cancelled) return;
        cart.setTable({ code: spot.code, label: spot.label });
        toast(`${spot.label} — سفارش‌ها سر همین میز می‌آید`);
      })
      .catch((e) => !cancelled && toast(errorMessage(e), 'error'))
      .finally(() => !cancelled && navigate('/', { replace: true }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
      <Spinner size={28} />
    </div>
  );
}
