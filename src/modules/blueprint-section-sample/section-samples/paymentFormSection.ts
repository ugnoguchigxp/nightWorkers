import type { SectionSampleDefinition } from './types';

export const paymentFormSectionSample: SectionSampleDefinition = {
  name: 'PaymentFormSection',
  props: ({ base }) => ({
    ...base,
    title: 'Payment details',
    description: 'Stripe-like payment form preview.',
    amount: '$128.00',
    actionLabel: 'Pay $128.00',
  }),
};
