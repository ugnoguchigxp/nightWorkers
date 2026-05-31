import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../components/ui/accordion';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import {
  DataTable,
  DataTableContent,
  DataTableFooter,
  DataTableHeader,
} from '../components/ui/data-table';
import { List, ListDivider, ListItem, ListSearchBox, ListTitle } from '../components/ui/list';
import { Progress } from '../components/ui/progress';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

const meta = {
  title: 'Components/Data Display',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Showcase: Story = {
  render: () => (
    <div className="grid gap-6">
      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Project status</CardTitle>
            <CardDescription>Card / Avatar / Progress sample</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex items-center gap-2">
              <Avatar>
                <AvatarImage src="https://github.com/shadcn.png" alt="Avatar" />
                <AvatarFallback>DS</AvatarFallback>
              </Avatar>
              <div className="text-sm">
                <p className="font-medium">Design System Team</p>
                <p className="text-muted-foreground">Ready for review</p>
              </div>
            </div>
            <Progress value={72} />
          </CardContent>
          <CardFooter>
            <Badge variant="outline">72%</Badge>
          </CardFooter>
        </Card>

        <Accordion defaultValue={['item-1']}>
          <AccordionItem value="item-1">
            <AccordionTrigger>What does this section contain?</AccordionTrigger>
            <AccordionContent>
              Data presentation components and structured content.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>Does it support tokens?</AccordionTrigger>
            <AccordionContent>
              All styling is token-driven and synced with .pen preview.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <List>
          <ListTitle>Members</ListTitle>
          <ListSearchBox>Search members...</ListSearchBox>
          <ListDivider />
          <ListItem checked>Alice</ListItem>
          <ListItem>Bob</ListItem>
          <ListItem>Carol</ListItem>
        </List>

        <DataTable>
          <DataTableHeader>
            <p className="text-sm font-medium">User Summary</p>
            <Badge variant="secondary">3 rows</Badge>
          </DataTableHeader>
          <DataTableContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span>Alice</span>
              <span className="text-muted-foreground">Owner</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Bob</span>
              <span className="text-muted-foreground">Editor</span>
            </div>
          </DataTableContent>
          <DataTableFooter className="text-sm text-muted-foreground">
            Updated 2 minutes ago
          </DataTableFooter>
        </DataTable>
      </section>

      <section className="max-w-3xl">
        <Table>
          <TableCaption>Recent invoices</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>INV001</TableCell>
              <TableCell>Paid</TableCell>
              <TableCell>$120.00</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>INV002</TableCell>
              <TableCell>Pending</TableCell>
              <TableCell>$80.00</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>Total</TableCell>
              <TableCell>$200.00</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </section>
    </div>
  ),
};
