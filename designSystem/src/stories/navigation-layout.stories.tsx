import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../components/ui/breadcrumb';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../components/ui/pagination';
import { Separator } from '../components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarSectionTitle,
} from '../components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

const meta = {
  title: 'Components/Navigation & Layout',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Showcase: Story = {
  render: () => (
    <div className="grid gap-6">
      <section className="grid gap-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Design System</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#" />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#" isActive>
                1
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#">2</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </section>

      <section className="grid gap-4 md:grid-cols-[260px_1fr]">
        <div className="h-[280px]">
          <Sidebar className="h-full w-full">
            <SidebarHeader>Workspace</SidebarHeader>
            <SidebarContent>
              <SidebarSectionTitle>Main</SidebarSectionTitle>
              <SidebarItem className="bg-sidebar-accent text-sidebar-accent-foreground">
                Dashboard
              </SidebarItem>
              <SidebarItem>Members</SidebarItem>
              <SidebarItem>Settings</SidebarItem>
            </SidebarContent>
            <SidebarFooter>v1.0.0</SidebarFooter>
          </Sidebar>
        </div>

        <div className="grid content-start gap-4">
          <Tabs defaultValue="overview" className="w-full max-w-md">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="members">Members</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">Overview content</TabsContent>
            <TabsContent value="members">Members content</TabsContent>
          </Tabs>

          <Separator />

          <div className="flex h-8 items-center gap-3 text-sm">
            <span>Left panel</span>
            <Separator orientation="vertical" />
            <span>Right panel</span>
          </div>
        </div>
      </section>
    </div>
  ),
};
