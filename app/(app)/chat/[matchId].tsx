import { useLocalSearchParams, useRouter } from "expo-router";
import { ChatView } from "../../../components/ChatView";

export default function Chat() {
  const router = useRouter();
  const { matchId, userId, name, photo } = useLocalSearchParams<{
    matchId: string;
    userId?: string;
    name?: string;
    photo?: string;
  }>();
  return (
    <ChatView
      matchId={matchId}
      userId={userId}
      name={name}
      photo={photo}
      onClose={() => (router.canGoBack() ? router.back() : router.replace("/matches"))}
    />
  );
}
