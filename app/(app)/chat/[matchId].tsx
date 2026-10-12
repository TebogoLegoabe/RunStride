import { useLocalSearchParams, useRouter } from "expo-router";
import { ChatView } from "../../../components/ChatView";

export default function Chat() {
  const router = useRouter();
  const { matchId, userId, name, photo, verified } = useLocalSearchParams<{
    matchId: string;
    userId?: string;
    name?: string;
    photo?: string;
    verified?: string;
  }>();
  return (
    <ChatView
      matchId={matchId}
      userId={userId}
      name={name}
      photo={photo}
      verified={verified === "1"}
      onClose={() => (router.canGoBack() ? router.back() : router.replace("/matches"))}
    />
  );
}
