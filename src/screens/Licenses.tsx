import { Link } from 'react-router-dom';

// Attribution required by CC BY-SA 4.0 for the Wiktionary data and the frequency list.
export function Licenses() {
  return (
    <>
      <Link to="/kurulum" className="text-sm text-muted">
        ← Ayarlar
      </Link>
      <h1 className="mt-2 mb-3 font-read text-[26px] font-semibold">Lisanslar ve kaynaklar</h1>
      <div className="card flex flex-col gap-3 text-sm">
        <section>
          <h2 className="font-semibold">Sözlük: Wiktionary</h2>
          <p className="mt-1 text-muted">
            Kelime bilgileri (çekimler, anlamlar, Türkçe ve İngilizce karşılıklar, eş/zıt anlamlılar) Almanca ve İngilizce{' '}
            <a className="text-accent underline" href="https://www.wiktionary.org/" target="_blank" rel="noreferrer">
              Wiktionary
            </a>{' '}
            katkıcılarına aittir. Veriler{' '}
            <a className="text-accent underline" href="https://kaikki.org/" target="_blank" rel="noreferrer">
              kaikki.org
            </a>{' '}
            (wiktextract, Tatu Ylonen) üzerinden alınmış, kısaltılıp yeniden düzenlenmiştir. Lisans:{' '}
            <a className="text-accent underline" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
              CC BY-SA 4.0
            </a>
            . Düzenlenmiş sözlük dosyaları da aynı lisansla paylaşılır.
          </p>
        </section>
        <section>
          <h2 className="font-semibold">Sıklık sıralaması: FrequencyWords</h2>
          <p className="mt-1 text-muted">
            Kelime sıklıkları Hermit Dave’in{' '}
            <a className="text-accent underline" href="https://github.com/hermitdave/FrequencyWords" target="_blank" rel="noreferrer">
              FrequencyWords
            </a>{' '}
            listesinden (OpenSubtitles 2018) hesaplanmıştır. Lisans: CC BY-SA 4.0.
          </p>
        </section>
        <section>
          <h2 className="font-semibold">Yazı tipleri</h2>
          <p className="mt-1 text-muted">Literata ve Figtree, SIL Open Font License 1.1.</p>
        </section>
      </div>
    </>
  );
}
