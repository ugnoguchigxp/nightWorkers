import { PreviewBadge, PreviewButton } from '../BlueprintPreviewPrimitives';
import { isObject, previewImageAlt, previewImageFor, toObjectArray } from '../previewModel';
import type { SectionRendererInput } from './types';

export function renderMediaTextSection({ componentName, props, t }: SectionRendererInput) {
  const title = String(props.title || props.headline || 'Feature story');
  const eyebrow = String(props.eyebrow || props.category || '');
  const description = String(
    props.description ||
      props.body ||
      'A balanced media and text section for article promos, feature blocks, and editorial explainers.'
  );
  const imagePosition = String(props.imagePosition || props.mediaPosition || 'left');
  const highlights = toObjectArray(props.highlights || props.items || props.bullets);
  const actions: Record<string, unknown>[] = [
    ...(isObject(props.primaryCta) ? [props.primaryCta] : []),
    ...toObjectArray(props.actions),
  ];
  const image = (
    <figure className="min-w-0">
      <img
        alt={previewImageAlt(props, title)}
        className="aspect-[4/3] w-full rounded-md border border-border object-cover"
        loading="lazy"
        src={previewImageFor(props, 'large', title)}
      />
      {props.caption ? (
        <figcaption className="mt-2 text-xs leading-5 text-muted-foreground">
          {String(props.caption)}
        </figcaption>
      ) : null}
    </figure>
  );
  const copy = (
    <div className="grid content-center gap-4">
      {eyebrow ? (
        <PreviewBadge className="w-fit py-0.5 text-[10px] uppercase">{eyebrow}</PreviewBadge>
      ) : null}
      <div>
        <h2 className="text-2xl font-semibold leading-tight tracking-normal text-foreground">
          {title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {highlights.length > 0 ? (
        <div className="grid gap-2">
          {highlights.slice(0, 4).map((item, index) => (
            <div className="flex gap-3 text-sm" key={String(item.id || item.title || index)}>
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <div>
                <div className="font-medium text-foreground">
                  {String(item.title || item.label || `Point ${index + 1}`)}
                </div>
                {item.description || item.body ? (
                  <div className="text-xs leading-5 text-muted-foreground">
                    {String(item.description || item.body)}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {actions.slice(0, 2).map((action, index) => (
            <PreviewButton
              tone={index === 0 ? 'primary' : 'plain'}
              key={String(action.id || action.label || index)}
            >
              {String(action.label || action.title || `Action ${index + 1}`)}
            </PreviewButton>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="grid gap-5 rounded-md border border-border bg-card p-4 md:grid-cols-2 md:p-5">
      {imagePosition === 'right' ? (
        <>
          {copy}
          {image}
        </>
      ) : (
        <>
          {image}
          {copy}
        </>
      )}
    </section>
  );
}
