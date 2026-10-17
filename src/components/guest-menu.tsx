"use client";

import { ChevronDownIcon, LogInIcon, UserPlusIcon, UserRoundIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Signed-out header control: one "Guest" dropdown holding Sign in / Create account. */
export function GuestMenu() {
  return (
    <DropdownMenuTrigger>
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 pl-1.5"
        aria-label="Guest menu"
        data-testid="guest-menu"
      >
        <Avatar size="sm">
          <AvatarFallback>
            <UserRoundIcon className="size-4" aria-hidden />
          </AvatarFallback>
        </Avatar>
        <span className="hidden sm:inline">Guest</span>
        <ChevronDownIcon className="hidden text-muted-foreground sm:block" />
      </Button>
      <DropdownMenu placement="bottom end" className="min-w-52">
        <DropdownMenuItem href="/login" data-testid="guest-menu-signin">
          <LogInIcon />
          Sign in
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem href="/signup" data-testid="guest-menu-signup">
          <UserPlusIcon />
          Create account
        </DropdownMenuItem>
      </DropdownMenu>
    </DropdownMenuTrigger>
  );
}
